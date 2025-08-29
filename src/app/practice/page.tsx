"use client";
import React from "react";
import { AudioRecorder } from "@/components/media/AudioRecorder";
import { NudgePopup, type NudgeType } from "@/components/nudge-popup";
import { getAsrProvider } from "@/core/asr/factory";
import type { AsrTranscript } from "@/core/asr/types";
import { startSession, endSession, logSessionEvent } from "@/lib/session-client";

export default function PracticePage() {
  const [providerName, setProviderName] = React.useState<string>("loading…");
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [nudge, setNudge] = React.useState<{ show: boolean; msg: string; type: NudgeType }>(
    { show: false, msg: "", type: "pace" }
  );
  const dismiss = () => setNudge((n) => ({ ...n, show: false }));
  const nudgeTimeout = React.useRef<number | null>(null);
  const lastCoachCallAt = React.useRef<number>(0);

  const showNudge = React.useCallback((msg: string, type: NudgeType) => {
    setNudge({ show: true, msg, type });
    if (nudgeTimeout.current) window.clearTimeout(nudgeTimeout.current);
    nudgeTimeout.current = window.setTimeout(() => setNudge((p) => ({ ...p, show: false })), 3000);
  }, []);

  const handleAmplitude = React.useCallback((level: number) => {
    // Simple heuristics: low volume → speak up; clipping unlikely here
    if (level < 0.02) showNudge("Speak a bit louder for clarity", "volume");
  }, [showNudge]);

  React.useEffect(() => {
  fetch("/api/config/asr", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setProviderName(String(d?.provider || d?.asrWorkflow || "unknown")))
      .catch(() => setProviderName("unknown"));
  }, []);

  // Wire ASR provider to emit transcripts to our nudge logic
  React.useEffect(() => {
    let cancel = false;
    (async () => {
      // Start session when practice mounts (best-effort)
      try {
        const s = await startSession({ type: "HR_BEHAVIORAL" });
        if (!cancel) setSessionId(s.id);
      } catch {}

      const asr = await getAsrProvider();
      asr.onPartial((t) => { if (!cancel) handleTranscript(t.text, t); });
      asr.onFinal((t) => { if (!cancel) handleTranscript(t.text, t); });
      await asr.start();
      return () => { asr.stop().catch(() => {}); };
    })();
    return () => {
      cancel = true;
      // End session on unmount (best-effort)
      if (sessionId) endSession(sessionId).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTranscript = React.useCallback((text: string, meta?: AsrTranscript) => {
    const lower = text.toLowerCase();
    const fillers = ["um", "uh", "like ", "you know", "basically", "actually"];
    if (fillers.some((f) => lower.includes(f))) {
      showNudge("Try reducing filler words", "filler");
      if (sessionId) logSessionEvent(sessionId, "nudge", { type: "filler", message: "Try reducing filler words" }).catch(() => {});
    }
    const words = lower.trim().split(/\s+/).filter(Boolean);
    // Very naive pace check: >150 wpm equivalent if >25 words in 10s chunk (not exact here)
    if (words.length > 25) {
      showNudge("Slow down a touch for clarity", "pace");
      if (sessionId) logSessionEvent(sessionId, "nudge", { type: "pace", message: "Slow down a touch for clarity" }).catch(() => {});
    }

    // ASR latency metric (approx): now minus provider event timestamp
    if (sessionId && meta?.timestamp) {
      const latency = Math.max(0, Date.now() - meta.timestamp);
      logSessionEvent(sessionId, "metric", { name: "asr_latency_ms", value: latency, isFinal: !!meta.isFinal }).catch(() => {});
    }

    // Call server coach for smarter nudges (throttled)
    const now = Date.now();
    if (now - lastCoachCallAt.current > 1500 && text.trim().length > 12) {
      lastCoachCallAt.current = now;
      // Estimate simple filler count in the snippet
      const fillerCount = fillers.reduce((acc, f) => acc + (lower.includes(f) ? 1 : 0), 0);
      const coachStart = Date.now();
      fetch("/api/coach/nudges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, fillerCount, timestamp: now }),
      })
        .then(async (r) => (r.ok ? r.json() : Promise.reject(await r.json())))
        .then((data) => {
          // Coach latency metric
          if (sessionId) {
            const coachLatency = Math.max(0, Date.now() - coachStart);
            logSessionEvent(sessionId, "metric", { name: "coach_latency_ms", value: coachLatency }).catch(() => {});
          }
          const first = data?.nudges?.[0];
          if (first?.message && first?.type) {
            showNudge(String(first.message), String(first.type) as NudgeType);
            if (sessionId) logSessionEvent(sessionId, "nudge", first).catch(() => {});
          }
        })
        .catch(() => {
          // silent fail for UX; consider logging later
        });
    }
  }, [showNudge, sessionId]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Practice Session</h1>
          <p className="text-gray-600">Speak naturally. We’ll listen and nudge you gently.</p>
        </header>

        <section className="bg-white rounded-2xl shadow-lg p-6">
          <div className="mb-4 text-xs text-gray-500">ASR Provider: <span className="font-medium text-gray-700">{providerName}</span></div>
          <div className="flex flex-col items-center gap-6">
            <div className="w-24 h-24 rounded-full shadow-inner flex items-center justify-center"
                 style={{ background: "radial-gradient(circle at 30% 30%, #e0e7ff, #f5f3ff)" }}
                 aria-hidden>
              <span className="text-indigo-600 font-semibold">🎤</span>
            </div>
            <AudioRecorder onAmplitude={handleAmplitude} onTranscript={handleTranscript} />
            <p className="text-sm text-gray-500">Tip: Pause briefly after key points.</p>
          </div>
        </section>
      </div>

      <NudgePopup show={nudge.show} message={nudge.msg} type={nudge.type} onDismiss={dismiss} />
    </div>
  );
}
