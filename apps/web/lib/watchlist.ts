import { connect, WatchItem, Client } from "@elefin/db";
import { Types } from "mongoose";
import { plain } from "./serialize";

export async function watchedClientIds(userId: string): Promise<Set<number>> {
  await connect();
  const rows = await WatchItem.find(
    { userId: new Types.ObjectId(userId) },
    { clientId: 1 },
  ).lean();
  return new Set(rows.map((r) => r.clientId));
}

export async function isWatched(userId: string, clientId: number): Promise<boolean> {
  await connect();
  return !!(await WatchItem.exists({
    userId: new Types.ObjectId(userId),
    clientId,
  }));
}

export interface WatchedClient {
  _id: number;
  name: string;
  referralCode: string | null;
  country: string;
  fundingIsFunded: boolean;
  fundingNetDeposit: number;
  accountsBalance: number;
  tradingTrades: number;
  tradingNetProfit: number;
  tradingLastTradeAt: string | null;
  commissionEarned: number;
  note: string;
  since: string | null;
}

export async function fetchWatchlist(userId: string): Promise<WatchedClient[]> {
  await connect();
  const items = await WatchItem.find({ userId: new Types.ObjectId(userId) })
    .sort({ createdAt: -1 })
    .lean();
  if (!items.length) return [];

  const byId = new Map(items.map((i) => [i.clientId, i]));
  const clients = await Client.find(
    { _id: { $in: [...byId.keys()] } },
    {
      name: 1,
      referralCode: 1,
      country: 1,
      fundingIsFunded: 1,
      fundingNetDeposit: 1,
      accountsBalance: 1,
      tradingTrades: 1,
      tradingNetProfit: 1,
      tradingLastTradeAt: 1,
      commissionEarned: 1,
    },
  ).lean();

  return clients
    .map((c) => {
      const p = plain<Omit<WatchedClient, "note" | "since">>(c);
      const item = byId.get(c._id)!;
      return {
        ...p,
        note: item.note ?? "",
        since: item.createdAt ? new Date(item.createdAt).toISOString() : null,
      };
    })
    .sort((a, b) => (b.since ?? "").localeCompare(a.since ?? ""));
}
