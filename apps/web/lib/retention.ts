import { connect, Client, Trade } from "@elefin/db";
import { cached } from "@elefin/cache";

const WEEK = 7 * 86_400_000;

/** Monday 00:00 UTC of the week containing `d`, in epoch ms. */
function weekStart(d: Date): number {
  const x = new Date(d);
  const day = (x.getUTCDay() + 6) % 7;
  x.setUTCHours(0, 0, 0, 0);
  x.setUTCDate(x.getUTCDate() - day);
  return x.getTime();
}

export interface RetentionGrid {
  maxOffset: number;
  cohorts: Array<{
    week: string; // YYYY-MM-DD (Monday)
    size: number; // funded clients that signed up that week
    cells: Array<number | null>; // % traded in week k after signup; null = not elapsed
  }>;
}

/**
 * Signup-cohort trading retention, computed straight from `trades` + `clients`.
 * A funded client "retained" in week k if they closed ≥1 trade in that week.
 */
export async function fetchRetention(): Promise<RetentionGrid> {
  return cached(
    "retention",
    { ttl: 1800, tags: ["clients", "trades"] },
    loadRetention,
  );
}

async function loadRetention(): Promise<RetentionGrid> {
  await connect();

  const clients = await Client.find(
    { fundingIsFunded: true, registeredAt: { $ne: null } },
    { registeredAt: 1 },
  ).lean();

  const cohortOf = new Map<number, number>();
  const sizes = new Map<number, number>();
  for (const c of clients) {
    const cw = weekStart(new Date(c.registeredAt as Date));
    cohortOf.set(c._id, cw);
    sizes.set(cw, (sizes.get(cw) ?? 0) + 1);
  }

  const trades = await Trade.find(
    { clientId: { $ne: null }, closeAt: { $ne: null } },
    { clientId: 1, closeAt: 1 },
  ).lean();

  const active = new Map<string, Set<number>>();
  let maxOffset = 0;
  for (const t of trades) {
    const cw = cohortOf.get(t.clientId as number);
    if (cw == null) continue;
    const off = Math.floor((weekStart(new Date(t.closeAt as Date)) - cw) / WEEK);
    if (off < 0) continue;
    if (off > maxOffset) maxOffset = off;
    const key = `${cw}|${off}`;
    let set = active.get(key);
    if (!set) active.set(key, (set = new Set()));
    set.add(t.clientId as number);
  }

  const nowWeek = weekStart(new Date());
  const cohorts = [...sizes.keys()]
    .sort()
    .map((cw) => {
      const size = sizes.get(cw)!;
      const elapsed = Math.floor((nowWeek - cw) / WEEK);
      const cells: Array<number | null> = [];
      for (let k = 0; k <= maxOffset; k += 1) {
        if (k > elapsed) cells.push(null);
        else cells.push(size ? Math.round(((active.get(`${cw}|${k}`)?.size ?? 0) / size) * 100) : 0);
      }
      return { week: new Date(cw).toISOString().slice(0, 10), size, cells };
    });

  return { maxOffset, cohorts };
}
