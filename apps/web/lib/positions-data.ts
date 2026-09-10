import { connect, Position, Client, SyncRun } from "@elefin/db";
import { plain } from "./serialize";

export interface OpenPositionRow {
  _id: string;
  clientId: number | null;
  clientName: string;
  login: string;
  symbol: string | null;
  side: "buy" | "sell" | null;
  volumeLots: number;
  openPrice: number | null;
  currentPrice: number | null;
  openAt: string | null;
  unrealizedPnl: number;
  asOf: string | null;
}

export interface PositionsResult {
  rows: OpenPositionRow[];
  kpis: {
    accounts: number;
    totalLots: number;
    unrealized: number;
    bySymbol: Array<{ symbol: string; lots: number; pnl: number }>;
  };
  lastSync: { at: string | null; status: string | null };
  positionsSyncEnabled: boolean;
}

export async function fetchPositions(): Promise<PositionsResult> {
  await connect();
  const [docs, lastRun] = await Promise.all([
    Position.find({}).sort({ unrealizedPnl: 1 }).lean(),
    SyncRun.findOne({ job: "positions" }).sort({ startedAt: -1 }).lean(),
  ]);

  const ids = [
    ...new Set(docs.map((d) => d.clientId).filter((x): x is number => x != null)),
  ];
  const names = new Map(
    (await Client.find({ _id: { $in: ids } }, { name: 1 }).lean()).map((c) => [
      c._id,
      c.name ?? "",
    ]),
  );

  const rows: OpenPositionRow[] = docs.map((d) => {
    const p = plain<Omit<OpenPositionRow, "clientName">>(d);
    return { ...p, clientName: p.clientId != null ? names.get(p.clientId) ?? "" : "" };
  });

  const bySymbol = new Map<string, { lots: number; pnl: number }>();
  const accounts = new Set<string>();
  let totalLots = 0;
  let unrealized = 0;
  for (const r of rows) {
    accounts.add(r.login);
    totalLots += r.volumeLots;
    unrealized += r.unrealizedPnl;
    const k = r.symbol ?? "?";
    const s = bySymbol.get(k) ?? { lots: 0, pnl: 0 };
    s.lots += r.volumeLots;
    s.pnl += r.unrealizedPnl;
    bySymbol.set(k, s);
  }

  return {
    rows,
    kpis: {
      accounts: accounts.size,
      totalLots: Math.round(totalLots * 100) / 100,
      unrealized: Math.round(unrealized * 100) / 100,
      bySymbol: [...bySymbol.entries()]
        .map(([symbol, v]) => ({ symbol, lots: Math.round(v.lots * 100) / 100, pnl: Math.round(v.pnl * 100) / 100 }))
        .sort((a, b) => b.lots - a.lots),
    },
    lastSync: {
      at: lastRun?.startedAt ? new Date(lastRun.startedAt).toISOString() : null,
      status: lastRun?.status ?? null,
    },
    positionsSyncEnabled: !!lastRun,
  };
}
