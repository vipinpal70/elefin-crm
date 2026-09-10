import "server-only";
import { headers } from "next/headers";
import { connect, AuditLog } from "@elefin/db";

/**
 * Append an entry to the audit trail. Never throws — auditing must not break the
 * action it records.
 */
export async function audit(
  userId: string | null,
  action: string,
  opts: { entity?: string; entityId?: string; meta?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await connect();
    let ip: string | null = null;
    try {
      const h = await headers();
      ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
    } catch {
      /* headers() unavailable outside a request */
    }
    await AuditLog.create({
      userId: userId ?? null,
      action,
      entity: opts.entity ?? null,
      entityId: opts.entityId ?? null,
      ip,
      meta: opts.meta ?? {},
      at: new Date(),
    });
  } catch (err) {
    console.error("audit write failed", err);
  }
}
