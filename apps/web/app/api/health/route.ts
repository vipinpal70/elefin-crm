import { NextResponse } from "next/server";
import { connect, mongoose } from "@elefin/db";
import { cacheHealth } from "@elefin/cache";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    await connect();
    const state = mongoose.connection.readyState; // 1 = connected
    const cache = await cacheHealth();
    return NextResponse.json({
      ok: state === 1,
      db: state === 1 ? "connected" : `state:${state}`,
      cache: cache.enabled ? (cache.ok ? "connected" : "unreachable") : "disabled",
      ms: Date.now() - started,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message, ms: Date.now() - started },
      { status: 503 },
    );
  }
}
