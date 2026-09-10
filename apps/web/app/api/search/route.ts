import { NextResponse, type NextRequest } from "next/server";
import { connect, Client, Account } from "@elefin/db";
import { cached } from "@elefin/cache";
import { requireSession } from "@/lib/auth";
import type { SearchHit } from "@/lib/search-types";

export const dynamic = "force-dynamic";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");


export async function GET(req: NextRequest) {
  await requireSession();
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ hits: [] });

  const hits = await cached(
    `search:${q.toLowerCase()}`,
    { ttl: 30, tags: ["clients"] },
    () => runSearch(q),
  );
  return NextResponse.json({ hits });
}

async function runSearch(q: string): Promise<SearchHit[]> {
  await connect();
  const rx = new RegExp(escapeRegex(q), "i");
  const asNum = Number(q);
  const isNum = Number.isInteger(asNum);

  const clientFilter: Record<string, unknown> = {
    $or: [{ name: rx }, { email: rx }, ...(isNum ? [{ _id: asNum }] : [])],
  };

  const [clients, accounts] = await Promise.all([
    Client.find(clientFilter, {
      name: 1,
      email: 1,
      referralCode: 1,
      country: 1,
      fundingIsFunded: 1,
    })
      .limit(8)
      .lean(),
    Account.find({ _id: { $regex: `^${escapeRegex(q)}` } }, { clientId: 1, accountType: 1 })
      .limit(6)
      .lean(),
  ]);

  return [
    ...clients.map((c) => ({
      type: "client" as const,
      id: String(c._id),
      title: c.name || `Client #${c._id}`,
      subtitle: [c.referralCode, c.country, c.fundingIsFunded ? "funded" : null]
        .filter(Boolean)
        .join(" · "),
      href: `/clients/${c._id}`,
    })),
    ...accounts.map((a) => ({
      type: "account" as const,
      id: String(a._id),
      title: `Account ${a._id}`,
      subtitle: `${a.accountType ?? "MT5"} · client #${a.clientId}`,
      href: `/accounts/${a._id}/history`,
    })),
  ];
}
