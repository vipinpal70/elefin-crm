"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { previewRosterUpload, commitRosterImport, importXmTrades } from "@/lib/imports-data";
import {
  confirmExternalTrader,
  confirmManyExternalTraders,
  type ConfirmDecision,
  type BulkConfirmResult,
} from "@/lib/tc-data";

export interface ImportFormState {
  error?: string;
  ok?: string;
}

/** Step 1: upload a roster sheet — parses, matches, saves a preview, then redirects to it. */
export async function uploadRoster(
  _prev: ImportFormState,
  fd: FormData,
): Promise<ImportFormState> {
  const owner = await requireRole("owner");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  const tags = String(fd.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const buffer = Buffer.from(await file.arrayBuffer());
  let summary;
  try {
    summary = await previewRosterUpload(buffer, file.name, owner.sub, tags);
  } catch (err) {
    return { error: `Could not read that file: ${(err as Error).message}` };
  }
  await audit(owner.sub, "import.roster.preview", {
    entity: "import_run",
    entityId: summary.importRunId,
    meta: { ...summary },
  });
  redirect(`/imports/${summary.importRunId}`);
}

/** Step 2: commit a preview. Unchecked rows (the `include` checkboxes on the review page) are left out. */
export async function commitImport(
  _prev: ImportFormState,
  fd: FormData,
): Promise<ImportFormState> {
  const owner = await requireRole("owner");
  const importRunId = String(fd.get("importRunId") ?? "");
  const includeKeys = fd.getAll("include").map(String);

  const result = await commitRosterImport(importRunId, includeKeys);
  if ("error" in result) return { error: result.error };

  await audit(owner.sub, "import.roster.commit", {
    entity: "import_run",
    entityId: importRunId,
    meta: { ...result },
  });
  revalidatePath(`/imports/${importRunId}`);
  revalidatePath("/imports");
  revalidatePath("/tc/clients");
  return {
    ok: `${result.linked + result.created + result.updated} rows are now waiting in TC for confirmation (${result.skipped} skipped).`,
  };
}

/** Move one TC row into the Elefin or XM book. Owner-gated — it can apply tags to a real client. */
export async function confirmTraderAction(
  traderId: string,
  decision: ConfirmDecision,
  linkedClientId?: number,
): Promise<ImportFormState> {
  const owner = await requireRole("owner");
  const result = await confirmExternalTrader(traderId, decision, linkedClientId);
  if ("error" in result) return { error: result.error };

  await audit(owner.sub, "import.tc.confirm", {
    entity: "external_trader",
    entityId: traderId,
    meta: { decision, linkedClientId: linkedClientId ?? null },
  });
  revalidatePath("/tc/clients");
  revalidatePath("/elefin/clients");
  revalidatePath("/xm/clients");
  if (decision === "elefin" && linkedClientId != null) {
    revalidatePath(`/elefin/clients/${linkedClientId}`);
  }
  return { ok: decision === "elefin" ? "Linked to Elefin client." : "Confirmed as XM." };
}

/**
 * Move many selected TC rows at once. Owner-gated, same as the single-row version.
 * "elefin" only applies to rows that already carry a suggested `linkedClientId` —
 * there's no per-row client picker in bulk mode, so the rest come back as skipped.
 */
export async function confirmManyTradersAction(
  traderIds: string[],
  decision: ConfirmDecision,
): Promise<BulkConfirmResult> {
  const owner = await requireRole("owner");
  const result = await confirmManyExternalTraders(traderIds, decision);

  await audit(owner.sub, "import.tc.confirm_many", {
    entity: "external_trader",
    entityId: traderIds.join(","),
    meta: { decision, confirmed: result.confirmed, skipped: result.skipped.length },
  });
  revalidatePath("/tc/clients");
  revalidatePath("/elefin/clients");
  revalidatePath("/xm/clients");
  return result;
}

/** XM trade-history upload — no preview gate, commits immediately (see sheet-plan.md §4.2). */
export async function uploadXmTradesAction(
  _prev: ImportFormState,
  fd: FormData,
): Promise<ImportFormState> {
  const owner = await requireRole("owner");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let summary;
  try {
    summary = await importXmTrades(buffer, file.name, owner.sub);
  } catch (err) {
    return { error: `Could not read that file: ${(err as Error).message}` };
  }
  await audit(owner.sub, "import.xm_trades", {
    entity: "import_run",
    entityId: summary.importRunId,
    meta: { ...summary },
  });
  revalidatePath("/imports");
  revalidatePath("/xm/dashboard");
  revalidatePath("/xm/clients");
  return {
    ok: `Imported ${summary.totalRows} trades across ${summary.logins} accounts.`,
  };
}
