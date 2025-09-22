export const dynamic = "force-dynamic";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import AnalyticsActions from "./AnalyticsActions";
import { TranscriptDownload } from "@/components/ui/transcript-download";

function fmt(n: number | null | undefined) {
  return typeof n === "number" ? new Intl.NumberFormat().format(n) : "-";
}

function formatDuration(seconds: number | null | undefined) {
  if (!seconds || seconds === 0) return "-";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function formatDurationMinutes(seconds: number | null | undefined) {
  if (!seconds || seconds === 0) return "-";
  const mins = (seconds / 60).toFixed(1);
  return `${mins} min`;
}

function getSessionStatus(session: { overallScore: number | null; duration: number | null }) {
  if (session.overallScore !== null) {
    return { status: "Analyzed", color: "text-green-600 bg-green-50", icon: "✓" };
  }
  if (session.duration && session.duration > 0) {
    return { status: "Ready to Analyze", color: "text-blue-600 bg-blue-50", icon: "📊" };
  }
  return { status: "In Progress", color: "text-yellow-600 bg-yellow-50", icon: "⏳" };
}

export default async function AnalyticsPage() {
  const sessions = await prisma.interviewSession.findMany({
    orderBy: { startedAt: "desc" },
    take: 100,
    select: {
      id: true,
      startedAt: true,
      completedAt: true,
      duration: true,
      overallScore: true,
      fluencyScore: true,
      confidenceScore: true,
      clarityScore: true,
      speakingPace: true,
      transcription: true,
    },
  });

  // Get token usage for all sessions (get the maximum tokens, not sum)
  const sessionIds = sessions.map(s => s.id);
  const tokenUsage = await prisma.tokenUsage.groupBy({
    by: ['sessionId'],
    where: {
      sessionId: { in: sessionIds }
    },
    _max: {
      totalTokens: true,
      totalCost: true,
    },
  });

  // Get all session events for analysis
  const sessionEvents = await prisma.sessionEvent.findMany({
    where: {
      sessionId: { in: sessionIds }
    },
    select: {
      sessionId: true,
      type: true,
      payload: true,
      ts: true
    },
    orderBy: { ts: 'asc' }
  });

  // Create maps for easy lookup
  const tokenMap = new Map(tokenUsage.map(t => [t.sessionId, t._max]));
  const connectionMap = new Map<string, { disconnections: number; reconnections: number; reasons: string[] }>();
  const transcriptMap = new Map<string, { transcript: string; wordCount: number; charCount: number; speakingPace: number; firstMessageTime?: number; lastMessageTime?: number }>();
  
  // Process all session events
  sessionEvents.forEach(event => {
    const sessionId = event.sessionId;
    
    // Handle connection events
    if (event.type === 'disconnection' || event.type === 'reconnection') {
      if (!connectionMap.has(sessionId)) {
        connectionMap.set(sessionId, { disconnections: 0, reconnections: 0, reasons: [] });
      }
      const stats = connectionMap.get(sessionId)!;
      
      if (event.type === 'disconnection') {
        stats.disconnections++;
        const payload = event.payload as any;
        if (payload?.reason) {
          stats.reasons.push(payload.reason);
        }
      } else if (event.type === 'reconnection') {
        stats.reconnections++;
      }
    }
    
    // Handle conversation messages to build transcript
    if (event.type === 'user_message' || event.type === 'ai_message') {
      if (!transcriptMap.has(sessionId)) {
        transcriptMap.set(sessionId, { transcript: '', wordCount: 0, charCount: 0, speakingPace: 0, firstMessageTime: undefined, lastMessageTime: undefined });
      }
      const transcriptData = transcriptMap.get(sessionId)!;
      
      const payload = event.payload as any;
      const role = payload?.role || (event.type === 'user_message' ? 'USER' : 'ASSISTANT');
      const content = payload?.content || '';
      
      if (content) {
        const speaker = role === 'USER' ? 'You' : 'AI';
        transcriptData.transcript += `${speaker}: ${content}\n\n`;
        
        // Track conversation timing
        const messageTime = new Date(event.ts).getTime();
        if (!transcriptData.firstMessageTime) {
          transcriptData.firstMessageTime = messageTime;
        }
        transcriptData.lastMessageTime = messageTime;
        
        // Count words and characters from user messages only for speaking metrics
        if (role === 'USER') {
          const words = content.trim().split(/\s+/).length;
          const chars = content.replace(/\s+/g, '').length;
          transcriptData.wordCount += words;
          transcriptData.charCount += chars;
        }
      }
    }
  });
  
  // Calculate speaking pace from actual conversation duration
  transcriptMap.forEach((transcriptData, sessionId) => {
    if (transcriptData.wordCount > 0 && transcriptData.firstMessageTime && transcriptData.lastMessageTime) {
      // Calculate actual conversation duration in seconds
      const conversationDurationSeconds = Math.max(1, (transcriptData.lastMessageTime - transcriptData.firstMessageTime) / 1000);
      transcriptData.speakingPace = Math.round((transcriptData.wordCount / conversationDurationSeconds) * 60); // words per minute
    }
  });

  // Add computed metrics to sessions
  const sessionsWithMetrics = sessions.map(session => {
    const tokens = tokenMap.get(session.id);
    const connections = connectionMap.get(session.id);
    const transcriptData = transcriptMap.get(session.id);
    
    // Use data from session events if available, otherwise fall back to session.transcription
    const transcription = transcriptData?.transcript || session.transcription || "";
    
    // Calculate metrics from session events first, then fall back to session.transcription
    let wordCount = transcriptData?.wordCount || 0;
    let charCount = transcriptData?.charCount || 0;
    let speakingPace = transcriptData?.speakingPace || session.speakingPace || 0;
    
    // If no session events data, try to extract from session.transcription
    if (!transcriptData && session.transcription?.trim()) {
      const transcriptionText = session.transcription.trim();
      // Split by lines and count only user messages (lines starting with "You:" or similar)
      const lines = transcriptionText.split('\n');
      let userText = '';
      
      for (const line of lines) {
        if (line.trim().toLowerCase().startsWith('you:') || 
            line.trim().toLowerCase().startsWith('user:') ||
            (!line.includes(':') && line.trim())) { // Assume lines without colons are user text
          const cleanLine = line.replace(/^(you:|user:)/i, '').trim();
          if (cleanLine) {
            userText += cleanLine + ' ';
          }
        }
      }
      
      if (userText.trim()) {
        wordCount = userText.trim().split(/\s+/).length;
        charCount = userText.replace(/\s+/g, '').length;
        
        if (session.duration && session.duration > 0) {
          speakingPace = Math.round((wordCount / session.duration) * 60);
        }
      } else {
        // Fallback: count all words if no clear user/AI distinction
        wordCount = transcriptionText.split(/\s+/).length;
        charCount = transcriptionText.length;
        if (session.duration && session.duration > 0) {
          speakingPace = Math.round((wordCount / session.duration) * 60);
        }
      }
    }
    
    // Calculate conversation duration from session events
    let conversationDuration = session.duration; // fallback to total session duration
    if (transcriptData?.firstMessageTime && transcriptData?.lastMessageTime) {
      conversationDuration = Math.max(1, (transcriptData.lastMessageTime - transcriptData.firstMessageTime) / 1000);
    }
    
    return {
      ...session,
      transcription,
      wordCount,
      charCount,
      speakingPace,
      conversationDuration, // actual conversation duration in seconds
      tokenCount: tokens?.totalTokens || 0,
      tokenCost: tokens?.totalCost || 0,
      disconnections: connections?.disconnections || 0,
      reconnections: connections?.reconnections || 0,
      disconnectionReasons: connections?.reasons || [],
    };
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <header className="space-y-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Conversation Analytics</h1>
            <p className="text-gray-600 mt-2">
              Analyze your speech patterns, track improvement, and get personalized insights from your practice sessions.
            </p>
          </div>
          
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start">
              <div className="text-blue-600 mr-3">💡</div>
              <div>
                <h3 className="font-semibold text-blue-900">How to get started:</h3>
                <ol className="text-blue-800 text-sm mt-1 space-y-1">
                  <li>1. Complete a practice session in the <Link href="/practice" className="underline">Practice</Link> section</li>
                  <li>2. Click &quot;Analyze&quot; on any session below to generate comprehensive speech analysis</li>
                  <li>3. View detailed charts and insights by clicking on the Session ID</li>
                </ol>
              </div>
            </div>
          </div>
        </header>

        <div className="overflow-x-auto rounded-xl border">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left">
                <th className="px-4 py-3 font-semibold text-gray-900">Session</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Status</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Started</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Duration</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Words</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Characters</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Tokens</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Disconnections</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Reasons</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Overall</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Fluency</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Clarity</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Confidence</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Pace (wpm)</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {sessionsWithMetrics.map((s) => {
                const sessionStatus = getSessionStatus(s);
                return (
                  <tr key={s.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link 
                        href={`/analytics/${s.id}`} 
                        className="text-blue-600 hover:text-blue-800 underline hover:no-underline"
                      >
                        {s.id.substring(0, 8)}...
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${sessionStatus.color}`}>
                        <span className="mr-1">{sessionStatus.icon}</span>
                        {sessionStatus.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {new Date(s.startedAt).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>
                    <td className="px-4 py-3">{formatDurationMinutes(s.conversationDuration)}</td>
                    <td className="px-4 py-3">{fmt(s.wordCount)}</td>
                    <td className="px-4 py-3">{fmt(s.charCount)}</td>
                    <td className="px-4 py-3">{fmt(s.tokenCount)}</td>
                    <td className="px-4 py-3">
                      {s.disconnections > 0 ? (
                        <span className="text-red-600 font-medium">{s.disconnections}</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {s.disconnectionReasons.length > 0 ? (
                        <span 
                          className="text-xs text-gray-600 cursor-help" 
                          title={s.disconnectionReasons.join(', ')}
                        >
                          {s.disconnectionReasons.slice(0, 2).join(', ')}
                          {s.disconnectionReasons.length > 2 && '...'}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {s.overallScore ? (
                        <span className="font-semibold text-blue-600">{Math.round(s.overallScore)}/100</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{fmt(s.fluencyScore)}</td>
                    <td className="px-4 py-3">{fmt(s.clarityScore)}</td>
                    <td className="px-4 py-3">{fmt(s.confidenceScore)}</td>
                    <td className="px-4 py-3">{fmt(s.speakingPace)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <AnalyticsActions sessionId={s.id} hasAnalysis={!!s.overallScore} />
                        <TranscriptDownload 
                          sessionId={s.id}
                          transcript={s.transcription}
                          startedAt={s.startedAt}
                        />
                        <Link 
                          className="text-xs text-gray-500 hover:text-gray-700 underline" 
                          href={`/api/sessions/${s.id}/analysis`} 
                          target="_blank"
                        >
                          JSON
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sessionsWithMetrics.length === 0 && (
                <tr>
                  <td colSpan={15} className="px-4 py-12 text-center">
                    <div className="text-gray-500">
                      <div className="text-4xl mb-2">📊</div>
                      <h3 className="text-lg font-semibold text-gray-700 mb-1">No sessions yet</h3>
                      <p className="text-sm">Start practicing to see your analytics here!</p>
                      <Link 
                        href="/practice" 
                        className="inline-block mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        Start Practice Session
                      </Link>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

