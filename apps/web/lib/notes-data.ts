import { connect, ClientNote, CrmUser, Client } from "@elefin/db";
import { cached, hashKey } from "@elefin/cache";

export type SP = Record<string, string | string[] | undefined>;

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
  clientEmail: string | null;
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
  return withClients(rows);
}

/** Join clientName/clientEmail onto rows that already have a clientId. */
async function withClients(rows: NoteRow[]): Promise<FollowUpRow[]> {
  const clients = new Map(
    (
      await Client.find(
        { _id: { $in: [...new Set(rows.map((r) => r.clientId))] } },
        { name: 1, email: 1 },
      ).lean()
    ).map((c) => [c._id, { name: c.name ?? "", email: c.email ?? null }]),
  );
  return rows.map((r) => {
    const c = clients.get(r.clientId);
    return { ...r, clientName: c?.name || `#${r.clientId}`, clientEmail: c?.email ?? null };
  });
}

/* ── full list — /elefin/notes ───────────────────────────────────── */

const SORTS = ["client", "due", "created", "author", "status"] as const;
export type NotesSortKey = (typeof SORTS)[number];

export interface NotesQuery {
  q?: string;
  status: "open" | "done" | "all";
  overdue?: boolean;
  sort: NotesSortKey;
  dir: "asc" | "desc";
}

const one = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

export function parseNotesQuery(sp: SP): NotesQuery {
  const status = one(sp.status);
  const sort = one(sp.sort);
  return {
    q: (one(sp.q) || "").trim() || undefined,
    status: status === "done" || status === "all" ? status : "open",
    overdue: one(sp.overdue) === "1" ? true : undefined,
    sort: sort && (SORTS as readonly string[]).includes(sort) ? (sort as NotesSortKey) : "due",
    dir: one(sp.dir) === "desc" ? "desc" : "asc",
  };
}

export function withNotesParams(current: NotesQuery, patch: Partial<NotesQuery>): string {
  const merged: NotesQuery = { ...current, ...patch };
  const p = new URLSearchParams();
  if (merged.q) p.set("q", merged.q);
  if (merged.status !== "open") p.set("status", merged.status);
  if (merged.overdue) p.set("overdue", "1");
  if (merged.sort !== "due") p.set("sort", merged.sort);
  if (merged.dir !== "asc") p.set("dir", merged.dir);
  const s = p.toString();
  return s ? `?${s}` : "";
}

const NOTES_CAP = 3000;

export async function fetchNotesList(q: NotesQuery): Promise<{ rows: FollowUpRow[]; total: number }> {
  return cached(`notes-list:${hashKey(q)}`, { ttl: 30, tags: ["notes"] }, () => loadNotesList(q));
}

async function loadNotesList(q: NotesQuery): Promise<{ rows: FollowUpRow[]; total: number }> {
  await connect();
  const now = new Date();
  const filter: Record<string, unknown> = {};
  if (q.status === "open") filter.doneAt = null;
  else if (q.status === "done") filter.doneAt = { $ne: null };
  if (q.overdue) {
    filter.dueAt = { $ne: null, $lt: now };
    filter.doneAt = null;
  }

  const docs = await ClientNote.find(filter).limit(NOTES_CAP).lean();
  const rows = await withAuthors(docs);
  let merged: FollowUpRow[] = await withClients(rows);

  if (q.q) {
    const needle = q.q.toLowerCase();
    merged = merged.filter(
      (r) =>
        r.body.toLowerCase().includes(needle) ||
        r.clientName.toLowerCase().includes(needle) ||
        String(r.clientId).includes(needle),
    );
  }

  const dir = q.dir === "desc" ? -1 : 1;
  const statusRank = (r: FollowUpRow): number => {
    if (r.doneAt) return 2;
    if (r.dueAt && new Date(r.dueAt) < now) return 0; // overdue first
    return 1;
  };
  const val = (r: FollowUpRow): string | number => {
    switch (q.sort) {
      case "client":
        return r.clientName;
      case "created":
        return r.createdAt ? new Date(r.createdAt).getTime() : 0;
      case "author":
        return r.authorName;
      case "status":
        return statusRank(r);
      case "due":
      default:
        return r.dueAt ? new Date(r.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    }
  };
  merged.sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    const primary = typeof av === "string" || typeof bv === "string" ? String(av).localeCompare(String(bv)) : av - bv;
    return primary * dir || (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  });

  return { rows: merged, total: merged.length };
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
