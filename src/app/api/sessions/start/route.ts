import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { safeAuth } from "@/lib/auth-wrapper";

export async function POST(req: NextRequest) {
  try {
    // Auth is optional in local/dev. If Clerk not configured, fallback to anonymous
    const authRes = await safeAuth();
    const userId = authRes?.userId ?? null;

    const body = await req.json().catch(() => ({}));
    const { type = "HR_BEHAVIORAL", jobDescription = null, questions = [] } = body || {};

    // If Prisma client isn't generated or DB is unavailable, fall back to ephemeral session
    try {
      const session = await prisma.interviewSession.create({
        data: {
          userId: userId ?? "anonymous",
          type,
          duration: 0,
          jobDescription,
          questions,
        },
      });
      return NextResponse.json({ id: session.id, startedAt: session.startedAt });
    } catch {
      // Ephemeral fallback
      const id = `local_${Date.now().toString(36)}`;
      return NextResponse.json({ id, startedAt: new Date().toISOString(), ephemeral: true });
    }
  } catch {
    return NextResponse.json({ error: "failed_to_start" }, { status: 500 });
  }
}
