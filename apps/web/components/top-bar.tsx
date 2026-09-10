import { destroySession, getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import type { SessionUser } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "@/components/global-search";
import { audit } from "@/lib/audit";

async function signOut() {
  "use server";
  const s = await getSession();
  if (s) await audit(s.sub, "auth.logout", { entity: "user", entityId: s.sub });
  await destroySession();
  redirect("/login");
}

export function TopBar({ user }: { user: SessionUser }) {
  return (
    <header className="flex h-12 items-center gap-3 border-b border-rule bg-raised px-3">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-accent-solid text-xs font-bold text-white shadow-[0_1px_2px_rgba(17,17,26,0.16)]">
          E
        </span>
        <span className="text-sm font-semibold tracking-tight">
          Elefin Partner CRM
        </span>
      </div>

      <GlobalSearch />

      <div className="flex items-center gap-3">
        <div className="text-right leading-tight">
          <p className="text-[13px] font-medium text-ink">{user.name || user.email}</p>
          <p className="text-[11px] uppercase tracking-[0.1em] text-muted">
            {user.role}
          </p>
        </div>
        <form action={signOut}>
          <Button variant="secondary" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}
