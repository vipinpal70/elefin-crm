import { connect, AppConfig } from "@elefin/db";
import { cached } from "@elefin/cache";

/** Starting catalogue (sheet-plan.md §6) — editable from Settings from here on. */
const DEFAULT_TAGS = ["5x", "Indicator", "Propfirm", "Gold", "BTC"];

export async function fetchTagCatalogue(): Promise<string[]> {
  return cached("tag-catalogue", { ttl: 300, tags: ["config"] }, loadTagCatalogue);
}

async function loadTagCatalogue(): Promise<string[]> {
  await connect();
  const cfg = await AppConfig.findById("tags").lean();
  const tags = (cfg?.data as { catalogue?: string[] } | undefined)?.catalogue;
  return Array.isArray(tags) && tags.length ? tags : DEFAULT_TAGS;
}
