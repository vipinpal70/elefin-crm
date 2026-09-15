"use server";

import { revalidatePath } from "next/cache";
import { Types } from "mongoose";
import { connect, SyncRequest, SYNC_JOBS } from "@elefin/db";
import { requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function requestSync(job: string): Promise<void> {
  const owner = await requireRole("owner");
  if (!(SYNC_JOBS as readonly string[]).includes(job)) return;

  await connect();
  const pending = await SyncRequest.exists({
    job,
    status: { $in: ["pending", "running"] },
  });
  if (!pending) {
    await SyncRequest.create({
      job,
      requestedBy: new Types.ObjectId(owner.sub),
    });
    await audit(owner.sub, "sync.request", { entity: "job", entityId: job });
  }
  revalidatePath("/elefin/sync");
}
