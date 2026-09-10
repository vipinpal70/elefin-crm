#!/usr/bin/env bash
# =============================================================================
#  deploye-elefin.sh  —  one-shot deploy for the Elefin Partner CRM
# =============================================================================
#  Target : Ubuntu / Debian server. Run it as root — it hands the deploy off
#           to an unprivileged user ('ubuntu' by default, created if missing).
#           Running as a sudo-capable user directly also works.
#  Does   :
#    1. installs Node 22, git, nginx, redis-server, certbot, PM2
#    2. clones / updates  https://github.com/vipinpal70/elefin-crm.git @ master
#       into  /home/ubuntu/elefin   (override with APP_DIR=...)
#    3. validates .env (never writes secrets — you fill it in once), sets
#       NODE_ENV=production and REDIS_URL
#    4. npm ci  ->  db:migrate  ->  db:seed  ->  build
#    5. starts web + worker under PM2 and persists them across reboots
#    6. writes + enables an nginx reverse-proxy vhost for the domain
#    7. opens the firewall (ufw: OpenSSH + "Nginx Full")
#    8. obtains a Let's Encrypt SSL cert with certbot --nginx (edits the vhost
#       in place: adds the 443 block, the cert lines and the HTTP->HTTPS
#       redirect) and leaves auto-renew running
#
#  Safe to re-run: every step is idempotent — re-running redeploys the latest
#  master and restarts the services.
#
#  Usage (as root):
#    chmod +x deploye-elefin.sh
#    CERTBOT_EMAIL=you@example.com ./deploye-elefin.sh
#
#  Re-use an existing checkout instead of a fresh clone:
#    APP_DIR=$(pwd) CERTBOT_EMAIL=you@example.com ./deploye-elefin.sh
#
#  Common overrides (env vars):
#    DOMAIN=elefin.tradecartel.in   APP_DIR=/home/ubuntu/elefin
#    BRANCH=master                  NODE_MAJOR=22        WEB_PORT=3000
#    CERTBOT_EMAIL=you@example.com  (recommended — expiry notices)
#    RUN_SEED=true                  ENABLE_UFW=true
#    SKIP_SSL=false                 FORCE_SSL=false  (attempt cert even if DNS
#                                                    does not point here yet)
#    DEPLOY_USER=ubuntu            unprivileged user to deploy as (created if
#                                 missing); DEPLOY_USER=root stays as root
# =============================================================================
set -Eeuo pipefail

# ---------------------------------------------------------------- config -------
DOMAIN="${DOMAIN:-elefin.tradecartel.in}"
REPO_URL="${REPO_URL:-https://github.com/vipinpal70/elefin-crm.git}"
BRANCH="${BRANCH:-master}"
APP_DIR="${APP_DIR:-/home/ubuntu/elefin}"
NODE_MAJOR="${NODE_MAJOR:-22}"
WEB_PORT="${WEB_PORT:-3000}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
RUN_SEED="${RUN_SEED:-true}"
ENABLE_UFW="${ENABLE_UFW:-true}"
SKIP_SSL="${SKIP_SSL:-false}"
FORCE_SSL="${FORCE_SSL:-false}"
DEPLOY_USER="${DEPLOY_USER:-ubuntu}"

# Absolute path to this script, so we can re-exec it after switching user.
SELF="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/$(basename -- "${BASH_SOURCE[0]}")"

REQUIRED_ENV_KEYS=(MONGODB_URI ELEFIN_API_KEY ELEFIN_API_SECRET SESSION_SECRET)
NGINX_SITE="/etc/nginx/sites-available/${DOMAIN}"
NGINX_LINK="/etc/nginx/sites-enabled/${DOMAIN}"

# ---------------------------------------------------------------- helpers ------
c_reset=$'\e[0m'; c_blue=$'\e[1;34m'; c_green=$'\e[1;32m'; c_yellow=$'\e[1;33m'; c_red=$'\e[1;31m'
step()  { printf '\n%s==>%s %s\n' "$c_blue"   "$c_reset" "$*"; }
ok()    { printf '%s  ok%s  %s\n' "$c_green"  "$c_reset" "$*"; }
warn()  { printf '%s WARN%s %s\n' "$c_yellow" "$c_reset" "$*" >&2; }
die()   { printf '%sFAIL%s %s\n' "$c_red"    "$c_reset" "$*" >&2; exit 1; }
have()  { command -v "$1" >/dev/null 2>&1; }
trap 'die "line $LINENO: \`$BASH_COMMAND\` exited $?"' ERR

# read a KEY=value line from an env file (value may contain '=')
get_env() { grep -E "^${1}=" "$2" 2>/dev/null | head -n1 | cut -d= -f2- ; }
# set (or append) KEY=value in an env file
set_env() {
  local key="$1" val="$2" file="$3" esc
  if grep -qE "^${key}=" "$file"; then
    esc=${val//\\/\\\\}; esc=${esc//|/\\|}
    sed -i "s|^${key}=.*|${key}=${esc}|" "$file"
  else
    printf '%s=%s\n' "$key" "$val" >> "$file"
  fi
}

# ---------------------------------------------------------------- preflight ----
step "Preflight"

# Launched as root? Set up an unprivileged user and hand the deploy off to it,
# unless the operator asked to stay root (DEPLOY_USER=root). ELEFIN_REEXEC guards
# against looping once we're back in here as that user.
if [ "$(id -u)" -eq 0 ] && [ "${ELEFIN_REEXEC:-}" != 1 ] && [ "$DEPLOY_USER" != root ]; then
  export DEBIAN_FRONTEND=noninteractive
  have sudo || { apt-get update -qq && apt-get install -y -qq sudo; }

  if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
    warn "user '$DEPLOY_USER' does not exist — creating it (home + bash + passwordless sudo)"
    useradd --create-home --shell /bin/bash "$DEPLOY_USER"
    printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$DEPLOY_USER" \
      > "/etc/sudoers.d/90-${DEPLOY_USER}-deploy"
    chmod 0440 "/etc/sudoers.d/90-${DEPLOY_USER}-deploy"
  elif ! sudo -u "$DEPLOY_USER" sudo -n true >/dev/null 2>&1; then
    warn "granting '$DEPLOY_USER' passwordless sudo for the deploy"
    printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$DEPLOY_USER" \
      > "/etc/sudoers.d/90-${DEPLOY_USER}-deploy"
    chmod 0440 "/etc/sudoers.d/90-${DEPLOY_USER}-deploy"
  fi

  # The deploy user must own its home and (if it already exists) its checkout,
  # or git / npm / next build will fail on writes.
  DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
  [ -n "$DEPLOY_HOME" ] && chown "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME" 2>/dev/null || true
  if [ -e "$APP_DIR" ]; then
    chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR" 2>/dev/null || true
  fi

  # Make sure the target user can read this script; copy to /tmp if not.
  if ! sudo -u "$DEPLOY_USER" test -r "$SELF" 2>/dev/null; then
    install -m 0755 "$SELF" /tmp/deploye-elefin.sh
    SELF=/tmp/deploye-elefin.sh
  fi

  step "Handing off to '$DEPLOY_USER'"
  exec sudo -u "$DEPLOY_USER" -H env \
    ELEFIN_REEXEC=1 DEPLOY_USER="$DEPLOY_USER" \
    DOMAIN="$DOMAIN" REPO_URL="$REPO_URL" BRANCH="$BRANCH" APP_DIR="$APP_DIR" \
    NODE_MAJOR="$NODE_MAJOR" WEB_PORT="$WEB_PORT" CERTBOT_EMAIL="$CERTBOT_EMAIL" \
    RUN_SEED="$RUN_SEED" ENABLE_UFW="$ENABLE_UFW" SKIP_SSL="$SKIP_SSL" FORCE_SSL="$FORCE_SSL" \
    bash "$SELF" "$@"
fi

# From here we are the deploy user (or root, if DEPLOY_USER=root).
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""            # already root — run system commands directly
  RUN_USER="root"
  RUN_HOME="/root"
  warn "running as root (DEPLOY_USER=root) — fine for a dedicated VPS"
else
  SUDO="sudo"
  have sudo || die "sudo not found for $(id -un) — install it, or run as root"
  sudo -v  || die "$(id -un) lacks sudo privileges — add it to sudoers, or run as root"
  RUN_USER="$(id -un)"
  RUN_HOME="$HOME"
fi
if ! have curl; then $SUDO apt-get update -qq && $SUDO apt-get install -y -qq curl; fi
ok "user=${RUN_USER}  domain=${DOMAIN}  dir=${APP_DIR}  branch=${BRANCH}"

# ---------------------------------------------------------------- packages -----
step "System packages (git, nginx, redis, certbot, ufw, build tools)"
export DEBIAN_FRONTEND=noninteractive
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq \
  ca-certificates curl gnupg git build-essential \
  ufw nginx redis-server certbot python3-certbot-nginx dnsutils
ok "base packages installed"

step "Node.js ${NODE_MAJOR}.x"
NODE_OK=false
if have node; then
  cur="$(node -v | sed 's/^v//; s/\..*//')"
  [ "${cur:-0}" -ge 20 ] && { NODE_OK=true; ok "node $(node -v) already present"; }
fi
if [ "$NODE_OK" != true ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource_setup.sh
  $SUDO bash /tmp/nodesource_setup.sh
  rm -f /tmp/nodesource_setup.sh
  $SUDO apt-get install -y -qq nodejs
  ok "installed node $(node -v)"
fi

step "PM2 (global)"
if have pm2; then ok "pm2 $(pm2 -v) already present"
else $SUDO npm install -g --silent pm2 && ok "installed pm2 $(pm2 -v)"; fi

# ---------------------------------------------------------------- redis --------
step "Redis"
$SUDO systemctl enable --now redis-server
if redis-cli ping 2>/dev/null | grep -q PONG; then ok "redis-server up (redis://127.0.0.1:6379)"
else warn "redis-cli ping did not return PONG — check 'systemctl status redis-server'"; fi

# ---------------------------------------------------------------- code ---------
step "Fetch source into ${APP_DIR}"
$SUDO mkdir -p "$(dirname "$APP_DIR")"
$SUDO chown "${RUN_USER}:${RUN_USER}" "$(dirname "$APP_DIR")"
if [ -d "${APP_DIR}/.git" ]; then
  git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
  git -C "$APP_DIR" remote set-url origin "$REPO_URL"
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/${BRANCH}"
  ok "updated to $(git -C "$APP_DIR" rev-parse --short HEAD)"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  ok "cloned $(git -C "$APP_DIR" rev-parse --short HEAD)"
fi
cd "$APP_DIR"

# ---------------------------------------------------------------- .env ---------
step "Environment file (${APP_DIR}/.env)"
if [ ! -f .env ]; then
  cp .env.example .env
  cat >&2 <<EOF
${c_yellow}
  Created ${APP_DIR}/.env from .env.example — it has placeholders only.
  Edit it now and set real values for:

      ${REQUIRED_ENV_KEYS[*]}
      SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD / SEED_OWNER_NAME

  Generate a session secret with:  openssl rand -base64 48
  Then re-run:  ./deploye-elefin.sh
${c_reset}
EOF
  die ".env needs your real credentials before deploy can continue"
fi

missing=()
for key in "${REQUIRED_ENV_KEYS[@]}"; do
  val="$(get_env "$key" .env)"
  case "$val" in
    ""|*xxxxxxxx*|*change-me*|*"change-me-to-a-long-random-string"*|"owner@example.com")
      missing+=("$key") ;;
  esac
done
[ "${#missing[@]}" -eq 0 ] || die ".env still has placeholder/empty values for: ${missing[*]}"

set_env NODE_ENV  production                 .env
grep -qE '^REDIS_URL=' .env || set_env REDIS_URL "redis://127.0.0.1:6379" .env
grep -qE '^TZ='        .env || set_env TZ "UTC" .env
ok ".env validated (NODE_ENV=production, REDIS_URL set)"

# ---------------------------------------------------------------- build --------
step "Install dependencies (npm ci)"
npm ci
mkdir -p logs

step "Database migrations"
npm run db:migrate
ok "migrations applied"

if [ "$RUN_SEED" = true ]; then
  step "Seed first owner (skips if users already exist)"
  npm run db:seed || warn "db:seed exited non-zero — continuing (owner likely exists)"
fi

step "Build the web app (next build)"
npm run build
ok "build complete"

# ---------------------------------------------------------------- pm2 ----------
step "Start services under PM2 (elefin-web + elefin-worker)"
pm2 delete ecosystem.config.cjs >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs --update-env
pm2 save

# reboot persistence
step "PM2 boot persistence (systemd)"
if [ -z "$SUDO" ]; then
  pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
  ok "pm2 systemd unit installed (root)"
else
  STARTUP_CMD="$(pm2 startup systemd -u "$RUN_USER" --hp "$RUN_HOME" 2>/dev/null | grep -E '^sudo ' || true)"
  if [ -n "$STARTUP_CMD" ]; then eval "$STARTUP_CMD" && ok "pm2 systemd unit installed"; else ok "pm2 startup already configured"; fi
fi
pm2 save
pm2 status || true

# ---------------------------------------------------------------- nginx --------
step "Nginx reverse-proxy vhost for ${DOMAIN} -> 127.0.0.1:${WEB_PORT}"
tmp_site="$(mktemp)"
cat > "$tmp_site" <<EOF
# Managed by deploye-elefin.sh — Elefin Partner CRM
# 'certbot --nginx' adds the listen 443 block, ssl_certificate lines and the
# HTTP->HTTPS redirect to this file in place. Do not hand-edit those.
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 10m;

    gzip on;
    gzip_proxied any;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript application/xml image/svg+xml;

    # Immutable Next.js build assets — cache hard at the edge/browser.
    location /_next/static/ {
        proxy_pass http://127.0.0.1:${WEB_PORT};
        proxy_set_header Host \$host;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        proxy_pass http://127.0.0.1:${WEB_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host  \$host;
        proxy_set_header Upgrade           \$http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout 60s;
        proxy_redirect off;
    }
}
EOF
$SUDO install -m 0644 "$tmp_site" "$NGINX_SITE"
rm -f "$tmp_site"
$SUDO ln -sfn "$NGINX_SITE" "$NGINX_LINK"
$SUDO rm -f /etc/nginx/sites-enabled/default
$SUDO nginx -t
$SUDO systemctl reload nginx
ok "vhost enabled and nginx reloaded"

# ---------------------------------------------------------------- firewall -----
step "Firewall (ufw)"
$SUDO ufw allow OpenSSH        >/dev/null 2>&1 || $SUDO ufw allow 22/tcp >/dev/null 2>&1 || true
$SUDO ufw allow 'Nginx Full'   >/dev/null 2>&1 || true
if [ "$ENABLE_UFW" = true ] && ! $SUDO ufw status | grep -q "Status: active"; then
  $SUDO ufw --force enable
fi
$SUDO ufw status verbose || true
ok "HTTP/HTTPS allowed through ufw"

# ---------------------------------------------------------------- ssl ----------
step "SSL certificate (Let's Encrypt via certbot --nginx)"
if [ "$SKIP_SSL" = true ]; then
  warn "SKIP_SSL=true — skipping certbot. Run later: certbot --nginx -d ${DOMAIN} --redirect"
else
  resolved_ip="$(getent ahostsv4 "$DOMAIN" | awk '{print $1; exit}' || true)"
  public_ip="$(curl -fsS4 https://api.ipify.org 2>/dev/null || curl -fsS4 https://ifconfig.me 2>/dev/null || true)"
  if [ -n "$resolved_ip" ] && [ -n "$public_ip" ] && [ "$resolved_ip" != "$public_ip" ] && [ "$FORCE_SSL" != true ]; then
    warn "${DOMAIN} resolves to ${resolved_ip} but this host is ${public_ip}."
    warn "DNS is not pointing here yet — skipping certbot to avoid a failed challenge."
    warn "Point the A record at ${public_ip}, then run:  certbot --nginx -d ${DOMAIN} --redirect"
  else
    email_flag=(--register-unsafely-without-email)
    [ -n "$CERTBOT_EMAIL" ] && email_flag=(-m "$CERTBOT_EMAIL")
    [ -n "$CERTBOT_EMAIL" ] || warn "no CERTBOT_EMAIL set — registering without one (no expiry reminders)"
    $SUDO certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect "${email_flag[@]}"
    $SUDO nginx -t && $SUDO systemctl reload nginx
    $SUDO systemctl list-timers 'certbot*' --no-pager 2>/dev/null | grep -q certbot \
      && ok "auto-renew timer active (certbot.timer)" \
      || warn "certbot renew timer not found — check 'systemctl status certbot.timer'"
  fi
fi

# ---------------------------------------------------------------- verify -------
step "Health check"
sleep 3
if curl -fsS "http://127.0.0.1:${WEB_PORT}/api/health" >/dev/null 2>&1; then
  ok "web app responding on 127.0.0.1:${WEB_PORT}/api/health"
else
  warn "web app not answering yet — check 'pm2 logs elefin-web'"
fi

cat <<EOF

${c_green}==========================================================================${c_reset}
 Elefin Partner CRM deployed.

   URL          : https://${DOMAIN}   (http:// if the cert step was skipped)
   App dir      : ${APP_DIR}
   Services     : pm2 status   |   pm2 logs elefin-web   |   pm2 logs elefin-worker
   Redeploy     : re-run ./deploye-elefin.sh  (pulls latest ${BRANCH}, rebuilds, restarts)
   Nginx vhost  : ${NGINX_SITE}
   Renew cert   : automatic (certbot.timer) — test with: certbot renew --dry-run

 Deployed as : ${RUN_USER}   (pm2 runs under this user; 'sudo -u ${RUN_USER} pm2 ls')
 Redis       : installed, running, REDIS_URL set. The web app uses it as a
               read-through cache (@elefin/cache) for dashboards / lists /
               analytics — invalidated per-tag by the worker after each sync.
               /api/health reports "cache": "connected". Set CACHE_DISABLED=1
               in .env to turn it off.
${c_green}==========================================================================${c_reset}
EOF

[ "$SELF" = /tmp/deploye-elefin.sh ] && rm -f /tmp/deploye-elefin.sh || true
