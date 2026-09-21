"use server";

import { revalidatePath } from "next/cache";
import { Types } from "mongoose";
import { z } from "zod";
import { connect, ClientNote, Client } from "@elefin/db";
import { invalidate } from "@elefin/cache";
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
  revalidatePath(`/elefin/clients/${clientId}`);
  revalidatePath("/elefin/alerts");
  revalidatePath("/elefin/notes");
  await invalidate("notes");
}

export interface NoteFormState {
  error?: string;
  ok?: string;
}

/** Add a note from /elefin/notes, where the client isn't already known from the page context. */
export async function addNoteQuick(_prev: NoteFormState, fd: FormData): Promise<NoteFormState> {
  const s = await requireSession();
  const parsed = z
    .object({
      clientId: z.coerce.number().int().positive(),
      body: z.string().trim().min(1).max(4000),
      due: z.string().optional(),
    })
    .safeParse({ clientId: fd.get("clientId"), body: fd.get("body"), due: fd.get("due") || undefined });
  if (!parsed.success) return { error: "Pick a client and enter a note first." };

  await connect();
  const client = await Client.findById(parsed.data.clientId, { name: 1 }).lean();
  if (!client) return { error: `No client #${parsed.data.clientId}.` };

  await ClientNote.create({
    clientId: parsed.data.clientId,
    authorId: new Types.ObjectId(s.sub),
    body: parsed.data.body,
    dueAt:
      parsed.data.due && isYmd(parsed.data.due)
        ? new Date(`${parsed.data.due}T09:00:00.000Z`)
        : null,
  });
  await audit(s.sub, "note.add", { entity: "client", entityId: String(parsed.data.clientId) });
  revalidatePath(`/elefin/clients/${parsed.data.clientId}`);
  revalidatePath("/elefin/alerts");
  revalidatePath("/elefin/notes");
  await invalidate("notes");
  return { ok: `Added for ${client.name || `#${parsed.data.clientId}`}.` };
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
  revalidatePath(`/elefin/clients/${note.clientId}`);
  revalidatePath("/elefin/alerts");
  revalidatePath("/elefin/notes");
  await invalidate("notes");
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
  revalidatePath(`/elefin/clients/${note.clientId}`);
  revalidatePath("/elefin/alerts");
  revalidatePath("/elefin/notes");
  await invalidate("notes");
}
