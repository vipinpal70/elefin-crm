"use server";

import { revalidatePath } from "next/cache";
import { Types } from "mongoose";
import { connect, Alert } from "@elefin/db";
import { invalidate } from "@elefin/cache";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function acknowledgeAlert(id: string): Promise<void> {
  const s = await requireSession();
  await connect();
  await Alert.updateOne(
    { _id: id },
    { $set: { acknowledgedAt: new Date(), acknowledgedBy: new Types.ObjectId(s.sub) } },
  );
  await audit(s.sub, "alert.acknowledge", { entity: "alert", entityId: id });
  revalidatePath("/alerts");
  await invalidate("alerts");
}

export async function unacknowledgeAlert(id: string): Promise<void> {
  const s = await requireSession();
  await connect();
  await Alert.updateOne(
    { _id: id },
    { $set: { acknowledgedAt: null, acknowledgedBy: null } },
  );
  await audit(s.sub, "alert.reopen", { entity: "alert", entityId: id });
  revalidatePath("/alerts");
  await invalidate("alerts");
}

export async function snoozeAlert(id: string, days: number): Promise<void> {
  const s = await requireSession();
  const d = Number.isFinite(days) && days > 0 ? Math.min(days, 90) : 7;
  await connect();
  await Alert.updateOne(
    { _id: id },
    { $set: { snoozedUntil: new Date(Date.now() + d * 86_400_000) } },
  );
  await audit(s.sub, "alert.snooze", { entity: "alert", entityId: id, meta: { days: d } });
  revalidatePath("/alerts");
  await invalidate("alerts");
}
