import { connect, ClientNote, CrmUser, Client } from "@elefin/db";
import { cached } from "@elefin/cache";

export interface NoteRow {
  _id: string;
  clientId: number;
  authorName: string;
  body: string;
  dueAt: string | null;
  doneAt: string | null;
  createdAt: string | null;
}

export async function fetchClientNotes(clientId: number): Promise<NoteRow[]> {
  await connect();
  const notes = await ClientNote.find({ clientId })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  return withAuthors(notes);
}

export interface FollowUpRow extends NoteRow {
  clientName: string;
}

/** Open follow-ups (dueAt set, not done) across every client, soonest first. */
export async function fetchOpenFollowUps(limit = 50): Promise<FollowUpRow[]> {
  return cached(
    `open-followups:${limit}`,
    { ttl: 60, tags: ["notes"] },
    () => loadOpenFollowUps(limit),
  );
}

async function loadOpenFollowUps(limit: number): Promise<FollowUpRow[]> {
  await connect();
  const notes = await ClientNote.find({ dueAt: { $ne: null }, doneAt: null })
    .sort({ dueAt: 1 })
    .limit(limit)
    .lean();
  const rows = await withAuthors(notes);
  const names = new Map(
    (
      await Client.find(
        { _id: { $in: [...new Set(rows.map((r) => r.clientId))] } },
        { name: 1 },
      ).lean()
    ).map((c) => [c._id, c.name ?? ""]),
  );
  return rows.map((r) => ({ ...r, clientName: names.get(r.clientId) ?? `#${r.clientId}` }));
}

/** Map of clientId -> count of open notes, for a page of the client list. */
export async function openNoteCounts(clientIds: number[]): Promise<Map<number, number>> {
  if (!clientIds.length) return new Map();
  await connect();
  const rows = await ClientNote.aggregate<{ _id: number; n: number }>([
    { $match: { clientId: { $in: clientIds }, doneAt: null } },
    { $group: { _id: "$clientId", n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id, r.n]));
}

async function withAuthors(
  notes: Array<Record<string, unknown>>,
): Promise<NoteRow[]> {
  const authorIds = [
    ...new Set(notes.map((n) => String(n.authorId)).filter(Boolean)),
  ];
  const authors = new Map(
    (await CrmUser.find({ _id: { $in: authorIds } }, { name: 1, email: 1 }).lean()).map(
      (u) => [String(u._id), u.name || u.email],
    ),
  );
  return notes.map((n) => ({
    _id: String(n._id),
    clientId: Number(n.clientId),
    authorName: authors.get(String(n.authorId)) ?? "—",
    body: String(n.body ?? ""),
    dueAt: n.dueAt ? new Date(n.dueAt as Date).toISOString() : null,
    doneAt: n.doneAt ? new Date(n.doneAt as Date).toISOString() : null,
    createdAt: n.createdAt ? new Date(n.createdAt as Date).toISOString() : null,
  }));
}
