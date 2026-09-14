import { Client } from "@elefin/db";
import { log } from "../logger";

/**
 * Which signal confirmed a client is no longer affiliated with our referral
 * code — see partner-code-change-plan.md.
 *   affiliated_false   — accounts.items[].affiliated came back false (strongest)
 *   lookup_failed      — GET /clients/{id} started failing for just this
 *                         client while it was already suspected missing
 *   missing_from_list  — absent from GET /clients for 2+ consecutive
 *                         sync-clients runs, with neither of the above
 *                         resolving it either way (weakest, used as a
 *                         fallback only)
 */
export type DepartureReason = "affiliated_false" | "lookup_failed" | "missing_from_list";

/** Flip one client to departed. No-op if already departed; returns whether it flipped. */
export async function markDeparted(clientId: number, reason: DepartureReason): Promise<boolean> {
  const res = await Client.updateOne(
    { _id: clientId, partnerStatus: { $ne: "departed" } },
    {
      $set: {
        partnerStatus: "departed",
        partnerStatusReason: reason,
        departedAt: new Date(),
        missingSince: null,
      },
    },
  );
  const flipped = (res.modifiedCount ?? 0) > 0;
  if (flipped) log.warn(`client ${clientId}: marked departed (${reason})`);
  return flipped;
}

/** Bulk version of markDeparted — returns how many actually flipped. */
export async function markDepartedMany(
  clientIds: number[],
  reason: DepartureReason,
): Promise<number> {
  if (!clientIds.length) return 0;
  const res = await Client.updateMany(
    { _id: { $in: clientIds }, partnerStatus: { $ne: "departed" } },
    {
      $set: {
        partnerStatus: "departed",
        partnerStatusReason: reason,
        departedAt: new Date(),
        missingSince: null,
      },
    },
  );
  return res.modifiedCount ?? 0;
}

/** Flip a departed client back to active (win-back). No-op if already active; returns whether it flipped. */
export async function reactivate(clientId: number): Promise<boolean> {
  const res = await Client.updateOne(
    { _id: clientId, partnerStatus: "departed" },
    {
      $set: {
        partnerStatus: "active",
        partnerStatusReason: null,
        departedAt: null,
        missingSince: null,
      },
    },
  );
  const flipped = (res.modifiedCount ?? 0) > 0;
  if (flipped) log.info(`client ${clientId}: reappeared under our code — reactivated`);
  return flipped;
}

/** Bulk version of reactivate — returns how many actually flipped. */
export async function reactivateMany(clientIds: number[]): Promise<number> {
  if (!clientIds.length) return 0;
  const res = await Client.updateMany(
    { _id: { $in: clientIds }, partnerStatus: "departed" },
    {
      $set: {
        partnerStatus: "active",
        partnerStatusReason: null,
        departedAt: null,
        missingSince: null,
      },
    },
  );
  return res.modifiedCount ?? 0;
}
