"use client";
import * as React from "react";

export default function AnalyticsActions({ sessionId, hasAnalysis }: { sessionId: string; hasAnalysis: boolean }) {
  const [busy, setBusy] = React.useState<string | null>(null);

  async function run(method: "POST" | "DELETE") {
    try {
      setBusy(method);
      const res = await fetch(`/api/sessions/${sessionId}/analysis`, { method });
      if (!res.ok) throw new Error(`${method}_failed`);
      location.reload();
    } catch (e) {
      console.error("analysis_action_failed", e);
      alert("Action failed. Check console.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        disabled={busy !== null}
        onClick={() => run("POST")}
        className="px-2 py-1 rounded bg-primary text-primary-foreground text-xs disabled:opacity-50"
        title="Compute or recompute analysis"
      >
        {busy === "POST" ? "Analyzing…" : hasAnalysis ? "Recompute" : "Analyze"}
      </button>
      <button
        disabled={busy !== null || !hasAnalysis}
        onClick={() => run("DELETE")}
        className="px-2 py-1 rounded bg-destructive text-destructive-foreground text-xs disabled:opacity-50"
        title="Delete saved analysis"
      >
        {busy === "DELETE" ? "Deleting…" : "Delete"}
      </button>
    </div>
  );
}



