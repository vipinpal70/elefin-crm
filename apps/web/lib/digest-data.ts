import { connect, Digest } from "@elefin/db";
import { cached } from "@elefin/cache";

export interface LatestDigest {
  date: string;
  text: string;
  generatedAt: string | null;
  delivered: boolean;
}

export async function fetchLatestDigest(): Promise<LatestDigest | null> {
  return cached("latest-digest", { ttl: 300, tags: ["digest"] }, loadLatestDigest);
}

async function loadLatestDigest(): Promise<LatestDigest | null> {
  await connect();
  const d = await Digest.findOne({}).sort({ generatedAt: -1 }).lean();
  if (!d) return null;
  return {
    date: d._id,
    text: d.text ?? "",
    generatedAt: d.generatedAt ? new Date(d.generatedAt).toISOString() : null,
    delivered: !!d.deliveredAt,
  };
}
