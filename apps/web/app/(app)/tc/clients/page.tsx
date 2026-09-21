import { requireRole } from "@/lib/auth";
import { fetchTcRows, parseTcQuery, type SP } from "@/lib/tc-data";
import { fetchTagCatalogue } from "@/lib/tags-data";
import { TcFilters } from "./tc-filters";
import { TcTable } from "./tc-table";

export const dynamic = "force-dynamic";

export default async function TcClientsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireRole("owner");
  const sp = await searchParams;
  const q = parseTcQuery(sp);
  const [rows, tagCatalogue] = await Promise.all([fetchTcRows(q), fetchTagCatalogue()]);

  return (
    <div className="p-4 lg:p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">TC — unconfirmed uploads</h1>
          <p className="mt-1 text-[12px] text-muted">
            Every roster upload lands here first. Nothing touches an Elefin client or the
            XM book until you confirm it below — flagged rows need a closer look before you do.
          </p>
        </div>
        <span className="rounded-full border border-tc-accent/30 bg-tc-accent-bg px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-tc-accent">
          TC
        </span>
      </div>

      <TcFilters q={q} tagCatalogue={tagCatalogue} total={rows.length} />
      <TcTable rows={rows} q={q} />
    </div>
  );
}
