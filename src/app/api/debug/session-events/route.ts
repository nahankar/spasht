import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId');
    
    if (sessionId) {
      // Get events for a specific session
      const events = await prisma.sessionEvent.findMany({
        where: { sessionId },
        orderBy: { ts: 'asc' },
        select: {
          id: true,
          type: true,
          ts: true,
          payload: true
        }
      });
      
      return NextResponse.json({ 
        sessionId, 
        eventCount: events.length,
        events: events.map(e => ({
          ...e,
          payloadPreview: typeof e.payload === 'object' && e.payload ? 
            JSON.stringify(e.payload).substring(0, 100) + '...' : 
            e.payload
        }))
      });
    }
    
    // Get summary of all recent sessions
    const recentSessions = await prisma.interviewSession.findMany({
      take: 5,
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        startedAt: true,
        duration: true,
        transcription: true,
        _count: {
          select: {
            events: true
          }
        }
      }
    });
    
    // Get event type counts
    const eventTypes = await prisma.sessionEvent.groupBy({
      by: ['type'],
      _count: {
        type: true
      }
    });
    
    return NextResponse.json({
      recentSessions: recentSessions.map(s => ({
        ...s,
        transcriptionLength: s.transcription?.length || 0,
        hasTranscription: !!s.transcription
      })),
      eventTypeCounts: eventTypes,
      totalEvents: eventTypes.reduce((sum, et) => sum + et._count.type, 0)
    });
    
  } catch (error) {
    console.error('Debug API error:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch debug data',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
