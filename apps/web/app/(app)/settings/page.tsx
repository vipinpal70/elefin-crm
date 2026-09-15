import { requireSession } from "@/lib/auth";
import {
  fetchUsers,
  fetchAlertThresholds,
  fetchAuditLog,
  fetchCredentialStatus,
} from "@/lib/settings-data";
import { readTargetConfig } from "@/lib/targets-data";
import { fetchTagCatalogue } from "@/lib/tags-data";
import {
  setUserActive,
  resetUserPassword,
  updateAlertThresholds,
  updateTargets,
  updateTagCatalogue,
} from "@/lib/actions/settings";
import { CreateUserForm, ChangePasswordForm } from "./forms";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { dateShort, dateTimeShort, relativeDays } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const me = await requireSession();
  const isOwner = me.role === "owner";

  const [users, thresholds, cred, audit, targets, tagCatalogue] = await Promise.all([
    isOwner ? fetchUsers() : Promise.resolve([]),
    isOwner ? fetchAlertThresholds() : Promise.resolve([]),
    isOwner ? fetchCredentialStatus() : Promise.resolve(null),
    isOwner ? fetchAuditLog() : Promise.resolve([]),
    isOwner ? readTargetConfig() : Promise.resolve(null),
    isOwner ? fetchTagCatalogue() : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-5">
      <h1 className="mb-4 text-lg font-semibold tracking-tight">Settings</h1>

      <Section title="Your account">
        <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5 text-[13px]">
          <dt className="text-muted">Name</dt>
          <dd className="text-ink">{me.name || "—"}</dd>
          <dt className="text-muted">Email</dt>
          <dd className="text-ink">{me.email}</dd>
          <dt className="text-muted">Role</dt>
          <dd className="text-ink">{me.role}</dd>
        </dl>
        <div className="mt-3 border-t border-rule pt-3">
          <ChangePasswordForm />
        </div>
      </Section>

      {!isOwner && (
        <p className="mt-3 text-[13px] text-muted">
          User management, alert thresholds and the API-credential panel are
          owner-only.
        </p>
      )}

      {isOwner && (
        <>
          <Section title="Elefin API credential">
            {cred?.ok ? (
              <dl className="grid grid-cols-[9rem_1fr] gap-y-1.5 text-[13px]">
                <dt className="text-muted">Status</dt>
                <dd className="text-ok">connected</dd>
                <dt className="text-muted">Key</dt>
                <dd className="text-ink">{cred.keyName}</dd>
                <dt className="text-muted">Abilities</dt>
                <dd className="text-ink">
                  {cred.allGranted ? "all" : (cred.abilities ?? []).join(", ") || "none"}
                </dd>
                <dt className="text-muted">Partner</dt>
                <dd className="text-ink">{cred.partner}</dd>
                <dt className="text-muted">Codes</dt>
                <dd className="font-mono text-[12px] text-ink-2">
                  {(cred.partnerCodes ?? []).join(", ")}
                </dd>
                <dt className="text-muted">Expires</dt>
                <dd className="text-ink">{cred.expiresAt ? dateShort(cred.expiresAt) : "never"}</dd>
                <dt className="text-muted">Clients (API)</dt>
                <dd className="text-ink tabular-nums">{cred.totalClients}</dd>
                <dt className="text-muted">Data from</dt>
                <dd className="text-ink-2">
                  trades {dateShort(cred.tradesFrom)} · txns {dateShort(cred.transactionsFrom)}
                </dd>
              </dl>
            ) : (
              <p className="text-[13px] text-err">
                Could not reach the API: {cred?.error ?? "unknown error"}
              </p>
            )}
            <p className="mt-2 text-[11px] text-muted">
              The secret is never shown. Rotate it with your Elefin contact and
              update <code>ELEFIN_API_SECRET</code> in <code>.env</code>.
            </p>
          </Section>

          <Section title={`Users (${users.length})`}>
            <div className="mb-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="border-b border-rule-2 text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                    <th className="py-1.5 pr-3 font-medium">Email</th>
                    <th className="py-1.5 pr-3 font-medium">Name</th>
                    <th className="py-1.5 pr-3 font-medium">Role</th>
                    <th className="py-1.5 pr-3 font-medium">Last login</th>
                    <th className="py-1.5 pr-3 font-medium">Status</th>
                    <th className="py-1.5 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u._id} className="border-b border-rule last:border-0">
                      <td className="py-1.5 pr-3">{u.email}</td>
                      <td className="py-1.5 pr-3 text-ink-2">{u.name || "—"}</td>
                      <td className="py-1.5 pr-3">{u.role}</td>
                      <td className="py-1.5 pr-3 text-ink-2">
                        {u.lastLoginAt ? relativeDays(u.lastLoginAt) : "never"}
                      </td>
                      <td className={cn("py-1.5 pr-3", u.isActive ? "text-ok" : "text-err")}>
                        {u.isActive ? "active" : "disabled"}
                      </td>
                      <td className="py-1.5">
                        <div className="flex items-center justify-end gap-2">
                          <form
                            action={resetUserPassword}
                            className="flex items-center gap-1"
                          >
                            <input type="hidden" name="userId" value={u._id} />
                            <input
                              name="password"
                              type="text"
                              placeholder="new pw"
                              minLength={8}
                              className="h-7 w-24 rounded border border-rule-2 bg-raised px-1.5 text-[12px]"
                            />
                            <button className="rounded border border-rule-2 px-1.5 py-0.5 text-[12px] text-ink-2 hover:text-ink">
                              reset
                            </button>
                          </form>
                          {u._id !== me.sub && (
                            <form action={setUserActive.bind(null, u._id, !u.isActive)}>
                              <button className="rounded border border-rule-2 px-1.5 py-0.5 text-[12px] text-ink-2 hover:text-ink">
                                {u.isActive ? "disable" : "enable"}
                              </button>
                            </form>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-rule pt-3">
              <CreateUserForm />
            </div>
          </Section>

          <Section title="Monthly targets">
            <p className="mb-2 text-[12px] text-muted">
              Set 0 to hide a target. Progress and pace show on the dashboard.
            </p>
            <form action={updateTargets} className="flex flex-wrap items-end gap-3">
              {(
                [
                  ["signups", "New signups"],
                  ["fundedClients", "Newly funded"],
                  ["netDeposits", "Net deposits ($)"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex flex-col gap-1 text-[12px] text-muted">
                  {label}
                  <input
                    name={key}
                    type="number"
                    min="0"
                    step="any"
                    defaultValue={targets?.[key] ?? 0}
                    className="h-7 w-28 rounded border border-rule-2 bg-raised px-1.5 text-[12px] text-ink"
                  />
                </label>
              ))}
              <Button size="sm" type="submit">
                Save targets
              </Button>
            </form>
          </Section>

          <Section title="Alert thresholds">
            <form action={updateAlertThresholds} className="space-y-2.5">
              {thresholds.map((rule) => (
                <div key={rule.type} className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="w-40 shrink-0 text-ink-2">{rule.description}</span>
                  {rule.params.map((p) => (
                    <label key={p.key} className="flex items-center gap-1 text-[12px] text-muted">
                      {p.key}
                      <input
                        name={`${rule.type}.${p.key}`}
                        type="number"
                        step="any"
                        defaultValue={p.value}
                        className="h-7 w-20 rounded border border-rule-2 bg-raised px-1.5 text-[12px] text-ink"
                      />
                    </label>
                  ))}
                </div>
              ))}
              <Button size="sm" type="submit">
                Save thresholds
              </Button>
            </form>
          </Section>

          <Section title="Tag catalogue">
            <p className="mb-2 text-[12px] text-muted">
              Comma-separated. Shown as suggestions on client/trader tag editors
              and roster uploads — both Elefin and XM.
            </p>
            <form action={updateTagCatalogue} className="flex flex-wrap items-end gap-2">
              <input
                name="tags"
                type="text"
                defaultValue={tagCatalogue.join(", ")}
                className="h-8 min-w-[20rem] flex-1 rounded-md border border-rule-2 bg-raised px-2 text-[13px] text-ink"
              />
              <Button size="sm" type="submit">
                Save tags
              </Button>
            </form>
          </Section>

          <Section title="Activity log">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[12px]">
                <tbody>
                  {audit.length === 0 ? (
                    <tr>
                      <td className="py-2 text-center text-muted">Nothing logged yet.</td>
                    </tr>
                  ) : (
                    audit.map((r) => (
                      <tr key={r._id} className="border-b border-rule last:border-0">
                        <td className="py-1 pr-3 tabular-nums text-muted">
                          {dateTimeShort(r.at)}
                        </td>
                        <td className="py-1 pr-3 text-ink-2">{r.userEmail}</td>
                        <td className="py-1 pr-3 font-mono text-ink">{r.action}</td>
                        <td className="py-1 text-muted">
                          {r.entity}
                          {r.entityId ? ` ${r.entityId}` : ""}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="mt-3 first:mt-0">
      <p className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
        {title}
      </p>
      {children}
    </Card>
  );
}
