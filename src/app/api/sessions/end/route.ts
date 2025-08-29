import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, transcript, report, completedAt = new Date().toISOString() } = body || {};
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "missing_id" }, { status: 400 });
    }
    const existing = await prisma.interviewSession.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const end = new Date(completedAt);
    const duration = Math.max(0, Math.round((end.getTime() - new Date(existing.startedAt).getTime()) / 1000));

    const updated = await prisma.interviewSession.update({
      where: { id },
      data: {
        transcription: typeof transcript === "string" ? transcript : existing.transcription,
        completedAt: end,
        duration,
        overallScore: report?.scores?.overall ?? existing.overallScore ?? null,
        fluencyScore: report?.scores?.fluency ?? existing.fluencyScore ?? null,
        confidenceScore: report?.scores?.confidence ?? existing.confidenceScore ?? null,
        clarityScore: report?.scores?.clarity ?? existing.clarityScore ?? null,
        speakingPace: report?.scores?.paceWpm ?? existing.speakingPace ?? null,
        fillerWords: report?.fillerWords ?? existing.fillerWords ?? null,
        suggestions: report?.tips ?? existing.suggestions ?? null,
      },
    });
    return NextResponse.json({ ok: true, id: updated.id, duration: updated.duration });
  } catch {
    return NextResponse.json({ error: "failed_to_end" }, { status: 500 });
  }
}
