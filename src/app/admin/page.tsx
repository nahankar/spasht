"use client";
import React from "react";

type Flags = {
  asrProvider: "TRANSCRIBE" | "NOVA_REALTIME" | "WEBSPEECH_FALLBACK";
  failoverMode: "FIXED" | "AUTO_SWITCH";
  language: string;
  nudgesRateLimitPerMin: number;
  reportPerSessionLimit: number;
  dataRetentionDays: number;
  piiRedactionEnabled: boolean;
  auditEnabled: boolean;
};

export default function AdminPage() {
  const [flags, setFlags] = React.useState<Flags | null>(null);
  const [original, setOriginal] = React.useState<Flags | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    fetch("/api/admin/flags")
      .then(async (r) => (r.ok ? r.json() : Promise.reject(await r.json())))
      .then((data) => {
        if (active) { setFlags(data); setOriginal(data); }
      })
  .catch(() => setError("Failed to load flags"))
      .finally(() => setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const save = async () => {
    if (!flags) return;
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/admin/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(flags),
      });
      if (!res.ok) throw await res.json();
      const data = await res.json();
  setFlags(data);
  setOriginal(data);
      setOk("Saved");
    } catch (e: unknown) {
      const hasError = (val: unknown): val is { error: unknown } =>
        !!val && typeof val === "object" && "error" in val;
      setError(hasError(e) ? JSON.stringify(e.error) : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6">Loading…</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;
  if (!flags) return <div className="p-6">No flags</div>;

  const isDirty = original ? JSON.stringify(flags) !== JSON.stringify(original) : true;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold">Admin Settings</h1>
          <a href="/admin/analytics" className="text-sm text-indigo-600 hover:underline">Analytics →</a>
        </div>
        <div className="bg-white rounded-xl shadow p-6 space-y-6">
          <section className="space-y-3">
            <h2 className="font-medium">ASR Provider</h2>
            <select
              className="border rounded px-3 py-2"
              value={flags.asrProvider}
              onChange={(e) => setFlags({ ...flags, asrProvider: e.target.value as Flags["asrProvider"] })}
            >
              <option value="TRANSCRIBE">AWS Transcribe</option>
              <option value="NOVA_REALTIME">Nova Realtime</option>
              <option value="WEBSPEECH_FALLBACK">WebSpeech (fallback)</option>
            </select>
          </section>

          <section className="space-y-3">
            <h2 className="font-medium">Failover</h2>
            <select
              className="border rounded px-3 py-2"
              value={flags.failoverMode}
              onChange={(e) => setFlags({ ...flags, failoverMode: e.target.value as Flags["failoverMode"] })}
            >
              <option value="FIXED">Fixed (no auto-switch)</option>
              <option value="AUTO_SWITCH">Auto switch on error</option>
            </select>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Language</label>
              <input className="border rounded px-3 py-2 w-full" value={flags.language} readOnly />
              <p className="text-xs text-gray-500 mt-1">en-US for now; more languages later.</p>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Data Retention (days)</label>
              <input
                type="number"
                min={7}
                max={3650}
                className="border rounded px-3 py-2 w-full"
                value={flags.dataRetentionDays}
                onChange={(e) => setFlags({ ...flags, dataRetentionDays: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Nudges Rate Limit / min</label>
              <input
                type="number"
                min={1}
                max={120}
                className="border rounded px-3 py-2 w-full"
                value={flags.nudgesRateLimitPerMin}
                onChange={(e) => setFlags({ ...flags, nudgesRateLimitPerMin: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Reports / session</label>
              <input
                type="number"
                min={1}
                max={10}
                className="border rounded px-3 py-2 w-full"
                value={flags.reportPerSessionLimit}
                onChange={(e) => setFlags({ ...flags, reportPerSessionLimit: Number(e.target.value) })}
              />
            </div>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={flags.piiRedactionEnabled}
                onChange={(e) => setFlags({ ...flags, piiRedactionEnabled: e.target.checked })}
              />
              <span>Enable PII Redaction</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={flags.auditEnabled}
                onChange={(e) => setFlags({ ...flags, auditEnabled: e.target.checked })}
              />
              <span>Enable Admin Audit Log</span>
            </label>
          </section>

      <div className="flex items-center gap-3">
            <button
              onClick={save}
        disabled={saving || !isDirty}
              className="bg-indigo-600 text-white rounded px-4 py-2 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {ok && <span className="text-green-600 text-sm">{ok}</span>}
            {error && <span className="text-red-600 text-sm">{error}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
