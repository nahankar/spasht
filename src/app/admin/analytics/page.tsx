export const dynamic = "force-dynamic";
import { prisma } from "@/lib/prisma";

function fmt(n: number) {
  return new Intl.NumberFormat().format(n);
}

export default async function AdminAnalyticsPage() {
  const now = new Date();
  const day7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Sessions
  const [totalSessions, sessions7d, sessions30d, avgDuration, sessionsLast30] = await Promise.all([
    prisma.interviewSession.count(),
    prisma.interviewSession.count({ where: { startedAt: { gte: day7 } } }),
    prisma.interviewSession.count({ where: { startedAt: { gte: day30 } } }),
    prisma.interviewSession.aggregate({ _avg: { duration: true } }),
    prisma.interviewSession.findMany({ where: { startedAt: { gte: day30 } }, select: { startedAt: true } }),
  ]);

  // Events
  let eventsCount = 0;
  let topNudges: Array<{ type: string; count: number }> = [];
  let p95Asr = 0;
  let p95Coach = 0;
  let asrRecent: number[] = [];
  let coachRecent: number[] = [];
  try {
    type SessionEventModel = {
      count(): Promise<number>;
      findMany(args: { where?: { type?: string }; orderBy?: { ts: "asc" | "desc" }; take?: number; select?: { payload: boolean } }): Promise<Array<{ payload: unknown }>>;
    };
    const sessionEvent = (prisma as unknown as Record<string, unknown>)["sessionEvent"] as SessionEventModel;
    eventsCount = await sessionEvent.count();
    const recentNudges = await sessionEvent.findMany({
      where: { type: "nudge" },
      orderBy: { ts: "desc" },
      take: 200,
      select: { payload: true },
    });
    const freq = new Map<string, number>();
    for (const e of recentNudges) {
      const t = (e?.payload as { type?: string } | null)?.type ?? "unknown";
      freq.set(t, (freq.get(t) || 0) + 1);
    }
    topNudges = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([type, count]) => ({ type, count }));

    // Latency metrics (p95) from recent metric events
    const recentMetrics = await sessionEvent.findMany({
      where: { type: "metric" },
      orderBy: { ts: "desc" },
      take: 1000,
      select: { payload: true },
    });
    const asrVals: number[] = [];
    const coachVals: number[] = [];
    for (const m of recentMetrics) {
      const p = (m.payload as { name?: string; value?: number } | null) || {};
      if (p.name === "asr_latency_ms" && typeof p.value === "number") asrVals.push(p.value);
      if (p.name === "coach_latency_ms" && typeof p.value === "number") coachVals.push(p.value);
    }
    asrRecent = asrVals.slice(-40);
    coachRecent = coachVals.slice(-40);
    const pct = (arr: number[], q: number) => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length) - 1);
      return Math.round(sorted[Math.max(0, idx)]);
    };
    p95Asr = pct(asrVals, 0.95);
    p95Coach = pct(coachVals, 0.95);
  } catch {
    // If migrations not applied yet, hide events
  }

  const avgSecs = Math.round((avgDuration._avg.duration || 0));

  // Aggregate sessions per day for last 30 days
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    days.push(dayKey(d));
  }
  const counts = new Map<string, number>();
  (sessionsLast30 as Array<{ startedAt: Date }>).forEach(({ startedAt }) => {
    counts.set(dayKey(new Date(startedAt)), (counts.get(dayKey(new Date(startedAt))) || 0) + 1);
  });
  const series = days.map((k) => counts.get(k) || 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto p-6 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold">Analytics</h1>
          <p className="text-sm text-gray-600">High-level product metrics</p>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard label="Total Sessions" value={fmt(totalSessions)} />
          <StatCard label="Sessions (7d)" value={fmt(sessions7d)} />
          <StatCard label="Sessions (30d)" value={fmt(sessions30d)} />
          <StatCard label="Avg Duration (s)" value={fmt(avgSecs)} />
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="font-medium mb-4">Recent Nudge Types</h2>
            {topNudges.length === 0 ? (
              <p className="text-sm text-gray-500">No data yet</p>
            ) : (
              <ul className="space-y-2">
                {topNudges.map((n) => (
                  <li key={n.type} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{n.type}</span>
                    <span className="font-medium">{fmt(n.count)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="font-medium mb-4">Events</h2>
            <p className="text-sm text-gray-700">Total events logged: <span className="font-semibold">{fmt(eventsCount)}</span></p>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="text-sm text-gray-700">ASR p95 latency: <span className="font-semibold">{fmt(p95Asr)} ms</span></div>
              <div className="text-sm text-gray-700">Coach p95 latency: <span className="font-semibold">{fmt(p95Coach)} ms</span></div>
            </div>
            <p className="text-xs text-gray-500 mt-2">Note: Apply Prisma migrations to enable event stats.</p>
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="font-medium mb-4">Sessions (Last 30 days)</h2>
            <Sparkline data={series} height={80} className="text-indigo-600" />
            <div className="mt-2 text-xs text-gray-500">Daily counts; right edge is today</div>
          </div>
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="font-medium mb-4">Latency Trends (recent)</h2>
            <div className="space-y-3">
              <div>
                <div className="text-xs text-gray-500 mb-1">ASR latency (ms)</div>
                <Sparkline data={asrRecent} height={60} className="text-emerald-600" />
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Coach latency (ms)</div>
                <Sparkline data={coachRecent} height={60} className="text-orange-600" />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl shadow p-6">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-semibold text-gray-900 mt-1">{value}</div>
    </div>
  );
}

function Sparkline({ data, width = 600, height = 100, className = "" }: { data: number[]; width?: number; height?: number; className?: string }) {
  const w = width; const h = height;
  const pad = 4;
  if (!data || data.length === 0) {
    return <div className="text-sm text-gray-500">No data</div>;
  }
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = Math.max(1, max - min);
  const step = (w - pad * 2) / Math.max(1, data.length - 1);
  const points = data.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (h - pad * 2) * (1 - (v - min) / span);
    return `${x},${y}`;
  }).join(" ");
  const last = data[data.length - 1];
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="sparkline" className="overflow-visible">
      <polyline fill="none" strokeWidth="2" stroke="currentColor" className={className} points={points} />
      <circle cx={pad + (data.length - 1) * step} cy={pad + (h - pad * 2) * (1 - (last - min) / span)} r="2.5" fill="currentColor" />
    </svg>
  );
}
