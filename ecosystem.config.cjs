/*
 * PM2 process manager — runs the CRM web app and the sync worker as services.
 *
 *   npm ci                          # install (root + all workspaces)
 *   cp .env.example .env            # fill in MONGODB_URI, ELEFIN_API_*, SESSION_SECRET…
 *   npm run db:migrate              # collections + indexes
 *   npm run pm2:start               # builds the web app, then `pm2 start` both
 *   pm2 save && pm2 startup         # (optional) bring both back up on server reboot
 *
 * Other:  npm run pm2:logs · pm2:restart · pm2:reload · pm2:stop · pm2:delete
 *
 * Both processes read the repo-root `.env` themselves (the web app via
 * next.config.ts, the worker via src/env.ts), so PM2 only pins NODE_ENV / TZ.
 * Logs go to ./logs (gitignored).
 */

const path = require("node:path");
const root = __dirname;
const logs = path.join(root, "logs");

/** @type {import('pm2').StartOptions} */
const common = {
  interpreter: "none", // `script` is `npm` — exec it directly, not via node
  instances: 1,
  exec_mode: "fork",
  autorestart: true,
  watch: false,
  time: false, // both apps already timestamp their own log lines
  merge_logs: true,
  min_uptime: "20s", // must stay up 20s to count as a good start
  max_restarts: 10, // …then PM2 gives up (crash-loop guard)
  env: { NODE_ENV: "production", TZ: "UTC" },
};

module.exports = {
  apps: [
    {
      ...common,
      name: "elefin-web",
      cwd: path.join(root, "apps/web"),
      script: "npm",
      args: "run start", // -> next start -p 4004
      max_memory_restart: "600M",
      restart_delay: 3000,
      kill_timeout: 10000,
      env: { ...common.env, PORT: "4004" },
      out_file: path.join(logs, "web.out.log"),
      error_file: path.join(logs, "web.err.log"),
    },
    {
      ...common,
      name: "elefin-worker",
      cwd: path.join(root, "apps/worker"),
      script: "npm",
      args: "run start", // -> tsx src/index.ts
      // Keep this at 1 instance: the cron scheduler and the sync_requests queue
      // are single-runner by design.
      max_memory_restart: "400M",
      restart_delay: 5000,
      kill_timeout: 20000, // let an in-flight sync finish + Mongo disconnect cleanly
      out_file: path.join(logs, "worker.out.log"),
      error_file: path.join(logs, "worker.err.log"),
    },
  ],
};
