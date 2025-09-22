import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { safeAuth } from "@/lib/auth-wrapper";

export async function GET() {
  try {
    const authRes = await safeAuth();
    const userId = authRes?.userId ?? "anonymous";

    const sessions = await prisma.interviewSession.findMany({
      where: { userId },
      select: { 
        duration: true,
        startedAt: true,
        completedAt: true,
        transcription: true
      },
      orderBy: { completedAt: 'desc' } // Most recent first
    });

    const totalSeconds = sessions.reduce((sum, session) => sum + session.duration, 0);
    const totalHours = totalSeconds / 3600;
    const completedSessions = sessions.filter(session => session.completedAt).length;
    const totalSessions = sessions.length;

    // Find the most recent completed session
    const previousSession = sessions.find(session => session.completedAt !== null);

    const countWords = (text: string | null | undefined) => {
      if (!text) return 0;
      return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
    };
    const countChars = (text: string | null | undefined) => {
      if (!text) return 0;
      return text.replace(/\s+/g, '').length;
    };

    const previousSessionData = previousSession ? {
      duration: previousSession.duration,
      hours: Math.round((previousSession.duration / 3600) * 100) / 100,
      minutes: Math.round((previousSession.duration / 60) * 100) / 100,
      startedAt: previousSession.startedAt,
      completedAt: previousSession.completedAt,
      words: countWords(previousSession.transcription),
      chars: countChars(previousSession.transcription)
    } : null;

    // Accumulated words/chars across all sessions (completed or not based on available transcription)
    const totalWords = sessions.reduce((sum, s) => sum + countWords(s.transcription), 0);
    const totalChars = sessions.reduce((sum, s) => sum + countChars(s.transcription), 0);

    return NextResponse.json({
      success: true,
      data: {
        totalHours: Math.round(totalHours * 100) / 100,
        totalSeconds,
        completedSessions,
        totalSessions,
        previousSession: previousSessionData,
        totalWords,
        totalChars
      },
    });
  } catch (error) {
    console.error("Error fetching session time data:", error);
    return NextResponse.json(
      { success: false, error: "failed_to_fetch_time_data" },
      { status: 500 }
    );
  }
}