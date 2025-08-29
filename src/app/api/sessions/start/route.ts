import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    const body = await req.json().catch(() => ({}));
    const { type = "HR_BEHAVIORAL", jobDescription = null, questions = [] } = body || {};
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
    return NextResponse.json({ error: "failed_to_start" }, { status: 500 });
  }
}
