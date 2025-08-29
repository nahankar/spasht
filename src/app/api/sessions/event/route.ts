import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, type, ts, payload } = body || {};
    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json({ error: "missing_sessionId" }, { status: 400 });
    }
    if (!type || typeof type !== "string") {
      return NextResponse.json({ error: "missing_type" }, { status: 400 });
    }
    const exists = await prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (!exists) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
    // NOTE: sessionEvent is new; until Prisma migrate/generate runs, use index access to avoid strict typing issues.
    const model = (prisma as unknown as Record<string, unknown>)["sessionEvent"] as {
      create(args: { data: { sessionId: string; type: string; ts?: Date; payload?: unknown } }): Promise<{ id: string; ts: string | Date }>;
    };
    const evt = await model.create({
      data: {
        sessionId,
        type,
        ts: ts ? new Date(ts) : undefined,
        payload: payload ?? null,
      },
    });
    return NextResponse.json({ id: evt.id, ts: evt.ts });
  } catch {
    return NextResponse.json({ error: "failed_to_log" }, { status: 500 });
  }
}
