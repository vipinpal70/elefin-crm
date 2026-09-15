import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchXmClient } from "@/lib/xm-data";
import { fetchTagCatalogue } from "@/lib/tags-data";
import { setExternalTraderTags } from "@/lib/actions/tags";
import { TagEditor } from "@/components/tag-editor";
import { Card, CardTitle, CardValue } from "@/components/ui/card";
import { dateTimeShort, num, num2, usd } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function XmClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [trader, tagCatalogue] = await Promise.all([fetchXmClient(id), fetchTagCatalogue()]);
  if (!trader) notFound();

  return (
    <div className="p-4 lg:p-5">
      <Link href="/xm/clients" className="text-[13px] text-accent hover:underline">
        ‹ XM clients
      </Link>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold tracking-tight">{trader.name || "Unnamed trader"}</h1>
        <span className="rounded-full border border-xm-accent/30 bg-xm-accent-bg px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-xm-accent">
          XM
        </span>
        {trader.linkedClientId != null ? (
          <Link
            href={`/elefin/clients/${trader.linkedClientId}`}
            className="rounded-full border border-accent/30 bg-accent-bg px-2 py-0.5 text-[10.5px] font-medium text-accent hover:underline"
          >
            Also Elefin client #{trader.linkedClientId}
          </Link>
        ) : null}
        {trader.needsReview ? (
          <span className="rounded-full border border-err/30 bg-err-bg px-2 py-0.5 text-[10.5px] font-medium text-err">
            Needs review
          </span>
        ) : null}
      </div>
      {trader.needsReview && trader.reviewReason ? (
        <p className="mt-1 text-[12px] text-err">{trader.reviewReason}</p>
      ) : null}

      <div className="mt-3">
        <TagEditor
          tags={trader.tags}
          catalogue={tagCatalogue}
          onSave={async (tags) => {
            "use server";
            await setExternalTraderTags(trader._id, tags);
          }}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Card>
          <CardTitle>MT5 login</CardTitle>
          <CardValue className="font-mono">{trader.mt5Login || "—"}</CardValue>
        </Card>
        <Card>
          <CardTitle>Trades</CardTitle>
          <CardValue>{num(trader.totalTrades)}</CardValue>
        </Card>
        <Card>
          <CardTitle>Lots</CardTitle>
          <CardValue>{num2(trader.totalLots)}</CardValue>
        </Card>
        <Card>
          <CardTitle>Commission</CardTitle>
          <CardValue className="text-ok">{usd(trader.totalCommission)}</CardValue>
        </Card>
      </div>

      <Card className="mt-3">
        <CardTitle>Identity</CardTitle>
        <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-1.5 text-[13px]">
          <dt className="text-muted">Email</dt>
          <dd className="text-ink">{trader.email || "—"}</dd>
          <dt className="text-muted">Phone</dt>
          <dd className="text-ink">{trader.phone || "—"}</dd>
          <dt className="text-muted">Trading capital</dt>
          <dd className="text-ink">{trader.tradingCapital != null ? usd(trader.tradingCapital) : "—"}</dd>
          <dt className="text-muted">Remarks</dt>
          <dd className="text-ink-2">{trader.remarks || "—"}</dd>
        </dl>
      </Card>

      <Card className="mt-3 overflow-x-auto p-0">
        <div className="p-3.5 pb-0">
          <CardTitle>Trade history</CardTitle>
        </div>
        <table className="mt-2 w-full min-w-[760px] text-[13px]">
          <thead>
            <tr className="border-b border-rule-2 text-left text-[11px] uppercase tracking-[0.08em] text-muted">
              <th className="px-3 py-1.5 font-medium">Closed</th>
              <th className="px-3 py-1.5 font-medium">Symbol</th>
              <th className="px-3 py-1.5 font-medium">Side</th>
              <th className="px-3 py-1.5 font-medium text-right">Lots</th>
              <th className="px-3 py-1.5 font-medium text-right">Open</th>
              <th className="px-3 py-1.5 font-medium text-right">Close</th>
              <th className="px-3 py-1.5 font-medium text-right">Commission</th>
            </tr>
          </thead>
          <tbody>
            {trader.trades.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted">
                  No trade-history rows for this login yet.
                </td>
              </tr>
            ) : (
              trader.trades.map((t) => (
                <tr key={t._id} className="border-b border-rule last:border-0">
                  <td className="px-3 py-1.5 tabular-nums text-ink-2">
                    {t.closeAt ? dateTimeShort(t.closeAt) : "—"}
                  </td>
                  <td className="px-3 py-1.5">{t.symbol || "—"}</td>
                  <td className={cn("px-3 py-1.5 capitalize", t.side === "buy" ? "text-ok" : t.side === "sell" ? "text-err" : "text-ink-2")}>
                    {t.side || "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{num2(t.volumeLots)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">{t.openPrice ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">{t.closePrice ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{usd(t.commission)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
