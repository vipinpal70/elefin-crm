import { requireSession } from "@/lib/auth";
import { TopBar } from "@/components/top-bar";
import { AppNav } from "@/components/app-nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireSession();

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar user={user} />
      <div className="flex flex-1">
        <aside className="w-44 shrink-0 border-r border-rule bg-raised">
          <AppNav />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
