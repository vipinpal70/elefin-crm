"use server";

import { revalidatePath } from "next/cache";
import { Types } from "mongoose";
import { z } from "zod";
import { connect, ClientNote } from "@elefin/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function addNote(clientId: number, fd: FormData): Promise<void> {
  const s = await requireSession();
  const parsed = z
    .object({ body: z.string().trim().min(1).max(4000), due: z.string().optional() })
    .safeParse({ body: fd.get("body"), due: fd.get("due") || undefined });
  if (!parsed.success) return;

  await connect();
  await ClientNote.create({
    clientId,
    authorId: new Types.ObjectId(s.sub),
    body: parsed.data.body,
    dueAt:
      parsed.data.due && isYmd(parsed.data.due)
        ? new Date(`${parsed.data.due}T09:00:00.000Z`)
        : null,
  });
  await audit(s.sub, "note.add", { entity: "client", entityId: String(clientId) });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/alerts");
}

export async function toggleNoteDone(noteId: string): Promise<void> {
  const s = await requireSession();
  await connect();
  const note = await ClientNote.findById(noteId);
  if (!note) return;
  note.doneAt = note.doneAt ? null : new Date();
  await note.save();
  await audit(s.sub, note.doneAt ? "note.done" : "note.reopen", {
    entity: "note",
    entityId: noteId,
  });
  revalidatePath(`/clients/${note.clientId}`);
  revalidatePath("/alerts");
}

export async function deleteNote(noteId: string): Promise<void> {
  const s = await requireSession();
  await connect();
  const note = await ClientNote.findById(noteId).lean();
  if (!note) return;
  // author or owner may delete
  if (String(note.authorId) !== s.sub && s.role !== "owner") return;
  await ClientNote.deleteOne({ _id: noteId });
  await audit(s.sub, "note.delete", { entity: "client", entityId: String(note.clientId) });
  revalidatePath(`/clients/${note.clientId}`);
  revalidatePath("/alerts");
}
