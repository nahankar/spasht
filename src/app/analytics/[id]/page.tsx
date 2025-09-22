import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import FillerChart from "../charts/FillerChart";
import PaceTrend from "../charts/PaceTrend";
import RadarScores from "../charts/RadarScores";
import DisfluencyChart from "../charts/DisfluencyChart";
import SpeechTimingChart from "../charts/SpeechTimingChart";
import VocabularyChart from "../charts/VocabularyChart";

async function getSessionAnalysis(sessionId: string) {
  // First try to get existing analysis
  const response = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/sessions/${sessionId}/analysis`, {
    cache: 'no-store'
  });
  
  if (response.ok) {
    const data = await response.json();
    if (data.overallScore !== null) {
      return data;
    }
  }
  
  // If no analysis exists, compute it
  const computeResponse = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/sessions/${sessionId}/analysis`, {
    method: 'POST',
    cache: 'no-store'
  });
  
  if (computeResponse.ok) {
    const result = await computeResponse.json();
    return result.analysis;
  }
  
  return null;
}

export default async function AnalyticsDetail({ params }: { params: { id: string } }) {
  const session = await prisma.interviewSession.findUnique({
    where: { id: params.id },
    include: {
      events: { orderBy: { ts: "asc" }, select: { ts: true, type: true, payload: true } },
    },
  });
  
  if (!session) return notFound();

  // Get comprehensive analysis
  const analysis = await getSessionAnalysis(params.id);
  
  if (!analysis) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <Link href="/analytics" className="text-blue-600 hover:underline text-sm">
              ← Back to Analytics
            </Link>
          </div>
          
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
            <h2 className="text-xl font-semibold text-yellow-800 mb-2">Analysis Not Available</h2>
            <p className="text-yellow-700 mb-4">Unable to generate analysis for this session.</p>
            <Link 
              href="/analytics" 
              className="inline-block bg-yellow-600 text-white px-4 py-2 rounded hover:bg-yellow-700"
            >
              Return to Analytics
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  // Prepare data for charts
  const radarData = {
    overall: analysis.overallScore || 0,
    fluency: analysis.fluencyScore || 0,
    clarity: analysis.clarityScore || 0,
    confidence: analysis.confidenceScore || 0,
    paceScore: analysis.paceScore || 0,
    vocabularyScore: analysis.vocabularyScore || 0,
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link href="/analytics" className="text-blue-600 hover:underline text-sm mb-4 inline-block">
            ← Back to Analytics
          </Link>
          
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Speech Analysis Report</h1>
              <p className="text-gray-600 mt-1">
                Session from {formatDate(session.createdAt)} • Duration: {formatDuration(session.duration || 0)}
              </p>
            </div>
            
            <div className="text-right">
              <div className="text-3xl font-bold text-blue-600">{analysis.overallScore}/100</div>
              <div className="text-sm text-gray-600">Overall Score</div>
            </div>
          </div>
        </div>

        {/* Key Metrics Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
          <div className="bg-white p-4 rounded-lg shadow border">
            <div className="text-2xl font-bold text-blue-600">{analysis.fluencyScore || 0}</div>
            <div className="text-sm text-gray-600">Fluency</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow border">
            <div className="text-2xl font-bold text-green-600">{analysis.clarityScore || 0}</div>
            <div className="text-sm text-gray-600">Clarity</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow border">
            <div className="text-2xl font-bold text-purple-600">{analysis.confidenceScore || 0}</div>
            <div className="text-sm text-gray-600">Confidence</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow border">
            <div className="text-2xl font-bold text-orange-600">{analysis.speakingPace || 0}</div>
            <div className="text-sm text-gray-600">WPM</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow border">
            <div className="text-2xl font-bold text-red-600">{(analysis.fillerWords || []).reduce((a: number, b: { count: number }) => a + b.count, 0)}</div>
            <div className="text-sm text-gray-600">Fillers</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow border">
            <div className="text-2xl font-bold text-indigo-600">{analysis.structureMetrics?.uniqueWords || 0}</div>
            <div className="text-sm text-gray-600">Unique Words</div>
          </div>
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Radar Chart - Overall Performance */}
          <div className="bg-white p-6 rounded-lg shadow border">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Performance Overview</h2>
            <RadarScores data={radarData} />
          </div>

          {/* Filler Words Analysis */}
          <div className="bg-white p-6 rounded-lg shadow border">
            <FillerChart data={analysis.fillerWords || []} />
          </div>

          {/* Speaking Pace Trend */}
          {analysis.turnMetrics && analysis.turnMetrics.length > 0 && (
            <div className="bg-white p-6 rounded-lg shadow border lg:col-span-2">
              <PaceTrend data={analysis.turnMetrics} />
            </div>
          )}

          {/* Disfluency Analysis */}
          {analysis.disfluencies && analysis.disfluencies.length > 0 && (
            <div className="bg-white p-6 rounded-lg shadow border">
              <DisfluencyChart data={analysis.disfluencies} />
            </div>
          )}

          {/* Speech Timing */}
          {analysis.speechTiming && (
            <div className="bg-white p-6 rounded-lg shadow border">
              <SpeechTimingChart data={analysis.speechTiming} />
            </div>
          )}

          {/* Vocabulary & Structure */}
          {analysis.structureMetrics && (
            <div className="bg-white p-6 rounded-lg shadow border lg:col-span-2">
              <VocabularyChart data={analysis.structureMetrics} />
            </div>
          )}
        </div>

        {/* Suggestions Section */}
        {analysis.suggestions && analysis.suggestions.length > 0 && (
          <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-blue-900 mb-4">💡 Improvement Suggestions</h2>
            <ul className="space-y-2">
              {analysis.suggestions.map((suggestion: string, index: number) => (
                <li key={index} className="flex items-start">
                  <span className="text-blue-600 mr-2">•</span>
                  <span className="text-blue-800">{suggestion}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Transcript Section */}
        {analysis.transcription && (
          <div className="mt-8 bg-gray-50 border border-gray-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">📝 Conversation Transcript</h2>
            <div className="bg-white p-4 rounded border max-h-96 overflow-y-auto">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono leading-relaxed">
                {analysis.transcription}
              </pre>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>Analysis generated on {formatDate(analysis.completedAt || new Date())}</p>
          <p className="mt-1">Session ID: <code className="bg-gray-100 px-1 rounded">{params.id}</code></p>
        </div>
      </div>
    </div>
  );
}