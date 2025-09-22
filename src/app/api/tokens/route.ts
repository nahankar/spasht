import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { safeAuth } from '@/lib/auth-wrapper';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      sessionId, 
      speechInput, 
      speechOutput, 
      textInput, 
      textOutput, 
      totalTokens, 
      totalCost 
    } = body;

    // Store token usage in database
    const tokenUsage = await prisma.tokenUsage.create({
      data: {
        sessionId,
        speechInput: speechInput || 0,
        speechOutput: speechOutput || 0,
        textInput: textInput || 0,
        textOutput: textOutput || 0,
        totalTokens: totalTokens || 0,
        totalCost: totalCost || 0,
        timestamp: new Date()
      }
    });

    return NextResponse.json({ success: true, data: tokenUsage });
  } catch (error) {
    console.error('Error storing token usage:', error);
    return NextResponse.json(
      { error: 'Failed to store token usage' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Auth is optional in local/dev. If Clerk not configured, fallback to anonymous
    const authRes = await safeAuth();
    const userId = authRes?.userId ?? "anonymous";
    
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (sessionId) {
      // First verify the session belongs to this user
      const session = await prisma.interviewSession.findFirst({
        where: { id: sessionId, userId }
      });
      
      if (!session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      }
      
      // Get token usage for specific session
      const sessionUsage = await prisma.tokenUsage.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'asc' }
      });

      const totalUsage = sessionUsage.reduce((acc, usage) => ({
        speechInput: acc.speechInput + usage.speechInput,
        speechOutput: acc.speechOutput + usage.speechOutput,
        textInput: acc.textInput + usage.textInput,
        textOutput: acc.textOutput + usage.textOutput,
        totalTokens: acc.totalTokens + usage.totalTokens,
        totalCost: acc.totalCost + usage.totalCost
      }), {
        speechInput: 0,
        speechOutput: 0,
        textInput: 0,
        textOutput: 0,
        totalTokens: 0,
        totalCost: 0
      });

      return NextResponse.json({ 
        success: true, 
        data: { 
          session: totalUsage,
          history: sessionUsage 
        }
      });
    } else {
      // Get user's sessions first, ordered by completion time
      const userSessions = await prisma.interviewSession.findMany({
        where: { userId },
        select: { id: true, completedAt: true },
        orderBy: { completedAt: 'desc' }
      });
      
      const sessionIds = userSessions.map(session => session.id);
      
      // Get accumulated usage across user's sessions only
      const allUsage = await prisma.tokenUsage.findMany({
        where: {
          sessionId: { in: sessionIds }
        },
        orderBy: { timestamp: 'desc' }
        // No limit for accurate totals - we need all records for proper accumulation
      });

      // Get previous (last completed) session token usage
      const previousCompletedSession = userSessions.find(session => session.completedAt !== null);
      let previousSessionUsage = null;
      
      if (previousCompletedSession) {
        const previousUsage = await prisma.tokenUsage.findMany({
          where: { sessionId: previousCompletedSession.id },
          orderBy: { timestamp: 'asc' }
        });

        previousSessionUsage = previousUsage.reduce((acc, usage) => ({
          speechInput: acc.speechInput + usage.speechInput,
          speechOutput: acc.speechOutput + usage.speechOutput,
          textInput: acc.textInput + usage.textInput,
          textOutput: acc.textOutput + usage.textOutput,
          totalTokens: acc.totalTokens + usage.totalTokens,
          totalCost: acc.totalCost + usage.totalCost
        }), {
          speechInput: 0,
          speechOutput: 0,
          textInput: 0,
          textOutput: 0,
          totalTokens: 0,
          totalCost: 0
        });
      }

      const totalUsage = allUsage.reduce((acc, usage) => ({
        speechInput: acc.speechInput + usage.speechInput,
        speechOutput: acc.speechOutput + usage.speechOutput,
        textInput: acc.textInput + usage.textInput,
        textOutput: acc.textOutput + usage.textOutput,
        totalTokens: acc.totalTokens + usage.totalTokens,
        totalCost: acc.totalCost + usage.totalCost
      }), {
        speechInput: 0,
        speechOutput: 0,
        textInput: 0,
        textOutput: 0,
        totalTokens: 0,
        totalCost: 0
      });

      return NextResponse.json({ 
        success: true, 
        data: { 
          accumulated: totalUsage,
          previous: previousSessionUsage,
          recent: allUsage.slice(0, 10) // Last 10 records
        }
      });
    }
  } catch (error) {
    console.error('Error retrieving token usage:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve token usage' },
      { status: 500 }
    );
  }
}
