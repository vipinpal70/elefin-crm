import { NextResponse } from "next/server";
import { connect, mongoose } from "@elefin/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    await connect();
    const state = mongoose.connection.readyState; // 1 = connected
    return NextResponse.json({
      ok: state === 1,
      db: state === 1 ? "connected" : `state:${state}`,
      ms: Date.now() - started,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message, ms: Date.now() - started },
      { status: 503 },
    );
  }
}
