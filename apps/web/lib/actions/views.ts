"use server";

import { revalidatePath } from "next/cache";
import { Types } from "mongoose";
import { z } from "zod";
import { connect, SavedView } from "@elefin/db";
import { requireSession } from "@/lib/auth";

const PAGES = ["clients", "funding"] as const;

export async function saveView(
  page: string,
  name: string,
  query: string,
): Promise<void> {
  const s = await requireSession();
  const parsed = z
    .object({
      page: z.enum(PAGES),
      name: z.string().trim().min(1).max(60),
      query: z.string().max(2000),
    })
    .safeParse({ page, name, query });
  if (!parsed.success) return;

  await connect();
  await SavedView.findOneAndUpdate(
    { userId: new Types.ObjectId(s.sub), page: parsed.data.page, name: parsed.data.name },
    { $set: { filters: { query: parsed.data.query.replace(/^\?/, "") } } },
    { upsert: true },
  );
  revalidatePath(`/elefin/${parsed.data.page}`);
}

export async function deleteView(id: string): Promise<void> {
  const s = await requireSession();
  await connect();
  await SavedView.deleteOne({ _id: id, userId: new Types.ObjectId(s.sub) });
  revalidatePath("/elefin/clients");
  revalidatePath("/elefin/funding");
}
