import { connect, SavedView } from "@elefin/db";
import { Types } from "mongoose";

export interface ViewRow {
  _id: string;
  name: string;
  query: string;
  mine: boolean;
}

export async function fetchViews(
  userId: string,
  page: string,
): Promise<ViewRow[]> {
  await connect();
  const uid = new Types.ObjectId(userId);
  const rows = await SavedView.find({
    page,
    $or: [{ userId: uid }, { isShared: true }],
  })
    .sort({ name: 1 })
    .lean();

  return rows.map((v) => ({
    _id: String(v._id),
    name: v.name,
    query: String((v.filters as { query?: string } | null)?.query ?? ""),
    mine: String(v.userId) === userId,
  }));
}
