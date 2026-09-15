"use server";

import { revalidatePath } from "next/cache";
import { connect, Client, ExternalTrader } from "@elefin/db";
import { invalidate } from "@elefin/cache";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

/** Replace a client's tag list wholesale (the tag editor sends the full set it wants). */
export async function setClientTags(clientId: number, tags: string[]): Promise<void> {
  const s = await requireSession();
  const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  await connect();
  await Client.updateOne({ _id: clientId }, { $set: { tags: clean } });
  await audit(s.sub, "client.tags", {
    entity: "client",
    entityId: String(clientId),
    meta: { tags: clean },
  });
  revalidatePath(`/elefin/clients/${clientId}`);
  revalidatePath("/elefin/clients");
  await invalidate("clients");
}

export async function setExternalTraderTags(traderId: string, tags: string[]): Promise<void> {
  const s = await requireSession();
  const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  await connect();
  await ExternalTrader.updateOne({ _id: traderId }, { $set: { tags: clean } });
  await audit(s.sub, "external_trader.tags", {
    entity: "external_trader",
    entityId: traderId,
    meta: { tags: clean },
  });
  revalidatePath(`/xm/clients/${traderId}`);
  revalidatePath("/xm/clients");
}
