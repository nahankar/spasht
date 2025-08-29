export async function startSession(init?: { type?: string; jobDescription?: string | null; questions?: unknown[] }) {
  const res = await fetch("/api/sessions/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(init || {}) });
  if (!res.ok) throw new Error("start_failed");
  return res.json() as Promise<{ id: string; startedAt: string }>
}

export async function endSession(id: string, data?: { transcript?: string; report?: unknown; completedAt?: string | number | Date }) {
  const res = await fetch("/api/sessions/end", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...data }) });
  if (!res.ok) throw new Error("end_failed");
  return res.json() as Promise<{ ok: boolean; id: string; duration: number }>
}

export async function logSessionEvent(sessionId: string, type: string, payload?: unknown, ts?: number) {
  const res = await fetch("/api/sessions/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, type, payload, ts }) });
  if (!res.ok) throw new Error("log_failed");
  return res.json() as Promise<{ id: string; ts: string }>
}
