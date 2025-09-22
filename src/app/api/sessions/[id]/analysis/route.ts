import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type FillerStat = { word: string; count: number };
type DisfluencyStat = { type: string; count: number };
type TurnMetric = { 
  turnIndex: number; 
  wordCount: number; 
  duration: number; 
  pace: number; 
  fillerCount: number;
  timestamp: string;
};

function analyzeTranscript(text: string) {
  const raw = String(text || "");
  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  // Enhanced filler words list including Indian English patterns
  const fillerWords = [
    "um", "uh", "like", "you know", "basically", "actually", "i mean", 
    "sort of", "kind of", "well", "so", "right", "okay", "yeah",
    // Indian English specific fillers
    "ah", "hmm", "aan", "acha", "haan", "na", "yaar", "matlab"
  ];

  const counts: Record<string, number> = {};
  for (const f of fillerWords) counts[f] = 0;

  const joined = tokens.join(" ");
  for (const f of fillerWords) {
    const re = new RegExp(`(?:^|\\s)${f}(?:$|\\s)`, "g");
    counts[f] = (joined.match(re) || []).length;
  }

  const fillerStats: FillerStat[] = Object.entries(counts)
    .filter(([, c]) => c > 0)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count);

  // Analyze disfluencies (repetitions, false starts, etc.)
  const disfluencies: DisfluencyStat[] = [];
  const repetitionPattern = /\b(\w+)\s+\1\b/gi;
  const repetitions = (raw.match(repetitionPattern) || []).length;
  if (repetitions > 0) disfluencies.push({ type: "Repetitions", count: repetitions });

  const falseStartPattern = /\b\w+\s*-\s*\w+/g;
  const falseStarts = (raw.match(falseStartPattern) || []).length;
  if (falseStarts > 0) disfluencies.push({ type: "False Starts", count: falseStarts });

  // Analyze sentence structure
  const sentences = raw.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const avgSentenceLength = sentences.length > 0 ? tokens.length / sentences.length : 0;
  const shortSentences = sentences.filter(s => s.trim().split(/\s+/).length < 5).length;
  const longSentences = sentences.filter(s => s.trim().split(/\s+/).length > 20).length;

  // Vocabulary richness
  const uniqueWords = new Set(tokens.filter(t => !fillerWords.includes(t))).size;
  const vocabularyRichness = tokens.length > 0 ? uniqueWords / tokens.length : 0;

  return { 
    tokens, 
    fillerStats, 
    disfluencies,
    sentences: sentences.length,
    avgSentenceLength,
    shortSentences,
    longSentences,
    vocabularyRichness,
    uniqueWords
  };
}

function scoreFromSignals({
  wordCount,
  minutes,
  fillerTotal,
  disfluencyTotal,
  vocabularyRichness,
  shortSentences,
  longSentences,
}: {
  wordCount: number;
  minutes: number;
  fillerTotal: number;
  disfluencyTotal: number;
  vocabularyRichness: number;
  shortSentences: number;
  longSentences: number;
}) {
  const pace = minutes > 0 ? wordCount / minutes : 0; // wpm
  
  // Scoring components (0-100 each)
  // 1. Pace scoring (ideal: 120-160 wpm)
  const pacePenalty = Math.max(0, Math.abs(pace - 140) / 4);
  const paceScore = Math.max(0, Math.min(100, Math.round(100 - pacePenalty)));
  
  // 2. Fluency (filler words + disfluencies)
  const fillerPenalty = Math.min(50, fillerTotal * 2);
  const disfluencyPenalty = Math.min(30, disfluencyTotal * 3);
  const fluencyScore = Math.max(0, Math.min(100, Math.round(100 - fillerPenalty - disfluencyPenalty)));
  
  // 3. Clarity (sentence structure)
  const structurePenalty = Math.min(40, (shortSentences + longSentences) * 2);
  const clarityScore = Math.max(0, Math.min(100, Math.round(100 - structurePenalty)));
  
  // 4. Vocabulary richness
  const vocabularyScore = Math.max(0, Math.min(100, Math.round(vocabularyRichness * 100)));
  
  // 5. Confidence (composite of other metrics)
  const confidenceScore = Math.round((paceScore + fluencyScore + clarityScore) / 3);
  
  // 6. Overall score (weighted average)
  const overallScore = Math.round(
    (paceScore * 0.25) + 
    (fluencyScore * 0.3) + 
    (clarityScore * 0.2) + 
    (vocabularyScore * 0.15) + 
    (confidenceScore * 0.1)
  );

  return { 
    overall: overallScore, 
    fluency: fluencyScore, 
    clarity: clarityScore, 
    confidence: confidenceScore, 
    pace: Math.round(pace),
    paceScore,
    vocabularyScore
  };
}

async function computeAnalysis(sessionId: string) {
  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    include: { events: { orderBy: { ts: "asc" } } },
  });
  if (!session) return { error: "session_not_found" as const };

  // Build transcript and turn-by-turn metrics from USER messages/events
  let transcript = session.transcription || "";
  const turnMetrics: TurnMetric[] = [];
  
  if (!transcript) {
    const parts: string[] = [];
    let turnIndex = 0;
    // let lastUserTimestamp: Date | null = null; // Currently unused
    
    for (let i = 0; i < session.events.length; i++) {
      const e = session.events[i];
      const p = (e.payload as Record<string, unknown>) || {};
      const role = p.role || p?.message?.role;
      const content = p.content || p?.message;
      
      if (role === "USER" && typeof content === "string" && content.trim()) {
        const turnText = content.trim();
        parts.push(turnText);
        
        // Calculate turn metrics
        const turnTokens = turnText.toLowerCase().split(/\s+/).filter(Boolean);
        const turnFillers = ["um", "uh", "like", "ah", "hmm"].reduce((count, filler) => {
          return count + (turnText.toLowerCase().match(new RegExp(`\\b${filler}\\b`, 'g')) || []).length;
        }, 0);
        
        // Estimate turn duration (time to next event or 3 seconds default)
        const currentTime = new Date(e.ts);
        let turnDuration = 3; // default 3 seconds
        if (i < session.events.length - 1) {
          const nextTime = new Date(session.events[i + 1].ts);
          turnDuration = Math.max(1, (nextTime.getTime() - currentTime.getTime()) / 1000);
        }
        
        const turnPace = turnDuration > 0 ? (turnTokens.length / turnDuration) * 60 : 0; // WPM
        
        turnMetrics.push({
          turnIndex,
          wordCount: turnTokens.length,
          duration: turnDuration,
          pace: Math.round(turnPace),
          fillerCount: turnFillers,
          timestamp: e.ts.toISOString(),
        });
        
        turnIndex++;
        // lastUserTimestamp = currentTime; // Currently unused
      }
    }
    transcript = parts.join("\n");
  }

  const analysisResult = analyzeTranscript(transcript);
  const { tokens, fillerStats, disfluencies, sentences, avgSentenceLength, 
          shortSentences, longSentences, vocabularyRichness, uniqueWords } = analysisResult;
  const wordCount = tokens.length;

  // Duration: prefer InterviewSession.duration, else derive from events
  let durationSeconds = session.duration || 0;
  if (!durationSeconds && session.events.length >= 2) {
    const first = new Date(session.events[0].ts).getTime();
    const last = new Date(session.events[session.events.length - 1].ts).getTime();
    durationSeconds = Math.max(1, Math.round((last - first) / 1000));
  }
  const minutes = durationSeconds / 60;
  const fillerTotal = fillerStats.reduce((a, b) => a + b.count, 0);
  const disfluencyTotal = disfluencies.reduce((a, b) => a + b.count, 0);

  const scores = scoreFromSignals({
    wordCount,
    minutes,
    fillerTotal,
    disfluencyTotal,
    vocabularyRichness,
    shortSentences,
    longSentences,
  });

  // Enhanced suggestions based on comprehensive analysis
  const suggestions: string[] = [];
  if (fillerTotal > 5) suggestions.push(`Reduce ${fillerTotal} filler words for cleaner delivery.`);
  if (scores.pace < 110) suggestions.push("Increase speaking pace slightly to sound more confident.");
  if (scores.pace > 170) suggestions.push("Slow down a touch to improve clarity and comprehension.");
  if (disfluencyTotal > 3) suggestions.push("Practice smoother speech to reduce repetitions and false starts.");
  if (vocabularyRichness < 0.6) suggestions.push("Expand vocabulary usage for more engaging communication.");
  if (shortSentences > sentences * 0.7) suggestions.push("Use longer sentences to express complex ideas more effectively.");
  if (longSentences > sentences * 0.3) suggestions.push("Break down complex sentences for better clarity.");
  if (avgSentenceLength < 8) suggestions.push("Develop ideas more fully with richer sentence structure.");

  // Calculate additional metrics
  const talkTime = turnMetrics.reduce((sum, turn) => sum + turn.duration, 0);
  const avgTurnLength = turnMetrics.length > 0 ? talkTime / turnMetrics.length : 0;
  const pauseEstimate = Math.max(0, durationSeconds - talkTime);

  const result = {
    transcription: transcript,
    overallScore: scores.overall,
    fluencyScore: scores.fluency,
    confidenceScore: scores.confidence,
    clarityScore: scores.clarity,
    speakingPace: scores.pace,
    paceScore: scores.paceScore,
    vocabularyScore: scores.vocabularyScore,
    fillerWords: fillerStats,
    disfluencies,
    suggestions,
    // Additional metrics
    speechTiming: {
      totalDuration: durationSeconds,
      talkTime: Math.round(talkTime),
      pauseTime: Math.round(pauseEstimate),
      avgTurnLength: Math.round(avgTurnLength * 100) / 100,
      turnCount: turnMetrics.length,
    },
    structureMetrics: {
      sentences,
      avgSentenceLength: Math.round(avgSentenceLength * 100) / 100,
      shortSentences,
      longSentences,
      vocabularyRichness: Math.round(vocabularyRichness * 1000) / 1000,
      uniqueWords,
    },
    turnMetrics,
  } as const;

  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: {
      transcription: result.transcription,
      overallScore: result.overallScore,
      fluencyScore: result.fluencyScore,
      confidenceScore: result.confidenceScore,
      clarityScore: result.clarityScore,
      speakingPace: result.speakingPace,
      fillerWords: result.fillerWords as unknown,
      suggestions: result.suggestions as string[],
      completedAt: new Date(),
      duration: durationSeconds || session.duration || 0,
    },
  });

  return { ok: true as const, analysis: result };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await prisma.interviewSession.findUnique({ 
      where: { id: params.id },
      include: { events: { orderBy: { ts: "asc" } } }
    });
    if (!session) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
    
    // If analysis exists, return it; otherwise return basic session data
    if (session.overallScore !== null) {
      return NextResponse.json({
        transcription: session.transcription,
        overallScore: session.overallScore,
        fluencyScore: session.fluencyScore,
        confidenceScore: session.confidenceScore,
        clarityScore: session.clarityScore,
        speakingPace: session.speakingPace,
        fillerWords: session.fillerWords,
        suggestions: session.suggestions,
        duration: session.duration,
        completedAt: session.completedAt,
        // Note: Extended metrics are computed on-demand in POST
      });
    } else {
      return NextResponse.json({
        transcription: null,
        overallScore: null,
        message: "Analysis not computed yet. Call POST to generate analysis.",
      });
    }
  } catch (_e) {
    return NextResponse.json({ error: "failed_to_fetch" }, { status: 500 });
  }
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const out = await computeAnalysis(params.id);
    if ('error' in out) return NextResponse.json(out, { status: 404 });
    return NextResponse.json(out);
  } catch (_e) {
    return NextResponse.json({ error: "failed_to_analyze" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await prisma.interviewSession.findUnique({ where: { id: params.id } });
    if (!session) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
    await prisma.interviewSession.update({
      where: { id: params.id },
      data: {
        transcription: null,
        overallScore: null,
        fluencyScore: null,
        confidenceScore: null,
        clarityScore: null,
        speakingPace: null,
        fillerWords: null,
        suggestions: null,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (_e) {
    return NextResponse.json({ error: "failed_to_delete" }, { status: 500 });
  }
}


