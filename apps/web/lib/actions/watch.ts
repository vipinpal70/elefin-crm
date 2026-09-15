"use server";

import { revalidatePath } from "next/cache";
import { Types } from "mongoose";
import { connect, WatchItem } from "@elefin/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function toggleWatch(clientId: number): Promise<boolean> {
  const s = await requireSession();
  await connect();
  const userId = new Types.ObjectId(s.sub);

  const existing = await WatchItem.findOne({ userId, clientId });
  let watched: boolean;
  if (existing) {
    await WatchItem.deleteOne({ _id: existing._id });
    watched = false;
  } else {
    await WatchItem.create({ userId, clientId });
    watched = true;
  }

  await audit(s.sub, watched ? "watch.add" : "watch.remove", {
    entity: "client",
    entityId: String(clientId),
  });
  revalidatePath(`/elefin/clients/${clientId}`);
  revalidatePath("/elefin/alerts");
  return watched;
}
