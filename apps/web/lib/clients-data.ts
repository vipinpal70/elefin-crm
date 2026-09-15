import { connect, Client } from "@elefin/db";
import { cached, hashKey } from "@elefin/cache";
import { plain } from "./serialize";
import { openNoteCounts } from "./notes-data";
import { buildFilter, sortSpec, type ClientsQuery } from "./clients-query";

const LIST_PROJECTION = {
  name: 1,
  country: 1,
  status: 1,
  referralCode: 1,
  registeredAt: 1,
  fundingIsFunded: 1,
  fundingDeposits: 1,
  fundingWithdrawals: 1,
  fundingNetDeposit: 1,
  tradingLots: 1,
  tradingTrades: 1,
  tradingNetProfit: 1,
  tradingLastTradeAt: 1,
  commissionEarned: 1,
  accountsCount: 1,
  partnerStatus: 1,
  departedAt: 1,
  tags: 1,
} as const;

export interface ClientRow {
  _id: number;
  name: string;
  country: string;
  status: string;
  referralCode: string | null;
  registeredAt: string | null;
  partnerStatus: "active" | "departed";
  departedAt: string | null;
  fundingIsFunded: boolean;
  fundingDeposits: number;
  fundingWithdrawals: number;
  fundingNetDeposit: number;
  tradingLots: number;
  tradingTrades: number;
  tradingNetProfit: number;
  tradingLastTradeAt: string | null;
  commissionEarned: number;
  accountsCount: number;
  openNotes: number;
  tags: string[];
}

export interface ClientsResult {
  rows: ClientRow[];
  total: number;
  codes: string[];
  countries: string[];
}

export async function fetchClients(q: ClientsQuery): Promise<ClientsResult> {
  return cached(
    `clients-list:${hashKey(q)}`,
    { ttl: 60, tags: ["clients", "notes"] },
    () => loadClients(q),
  );
}

async function loadClients(q: ClientsQuery): Promise<ClientsResult> {
  await connect();
  const filter = buildFilter(q);

  const [rows, total, codes, countries] = await Promise.all([
    Client.find(filter, LIST_PROJECTION)
      .sort(sortSpec(q))
      .skip((q.page - 1) * q.perPage)
      .limit(q.perPage)
      .lean(),
    Client.countDocuments(filter),
    Client.distinct("referralCode"),
    Client.distinct("country"),
  ]);

  const noteCounts = await openNoteCounts(rows.map((r) => r._id));

  return {
    rows: rows.map((r) => ({
      ...plain<Omit<ClientRow, "openNotes" | "tags">>(r),
      // pre-existing docs from before the `tags` field was added have none
      tags: r.tags ?? [],
      openNotes: noteCounts.get(r._id) ?? 0,
    })),
    total,
    codes: (codes as (string | null)[]).filter((x): x is string => !!x).sort(),
    countries: (countries as (string | null)[])
      .filter((x): x is string => !!x)
      .sort(),
  };
}
