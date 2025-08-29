export type AsrProviderKey = "TRANSCRIBE" | "NOVA_REALTIME" | "WEBSPEECH_FALLBACK";

export interface AsrFactoryConfig {
  provider: AsrProviderKey;
  language: string;
  failover: "FIXED" | "AUTO_SWITCH";
}

// Placeholder types for now. We'll wire implementations next.
export interface AsrInstance {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export async function createAsrProvider(cfg: AsrFactoryConfig): Promise<AsrInstance> {
  // Choose concrete provider or failover chain.
  const makeWeb = async () => {
    const { WebSpeechAsr } = await import("./webspeech");
    return new WebSpeechAsr();
  };
  const makeTranscribe = async () => {
    const { TranscribeAsr } = await import("./transcribe");
    return new TranscribeAsr();
  };
  const makeNova = async () => {
    const { NovaRealtimeAsr } = await import("./novaRealtime");
    return new NovaRealtimeAsr();
  };

  if (cfg.failover === "AUTO_SWITCH") {
    const { FailoverAsr } = await import("./failover");
    // Primary is selected provider; fallbacks are Transcribe then WebSpeech.
  const chain: Array<() => Promise<import("./types").AsrProvider>> = [];
    if (cfg.provider === "NOVA_REALTIME") chain.push(makeNova, makeTranscribe, makeWeb);
    else if (cfg.provider === "TRANSCRIBE") chain.push(makeTranscribe, makeWeb);
    else chain.push(makeWeb);
    return new FailoverAsr(chain);
  }

  switch (cfg.provider) {
    case "NOVA_REALTIME":
      return makeNova();
    case "TRANSCRIBE":
      return makeTranscribe();
    default:
      return makeWeb();
  }
}
import type { AsrProvider } from "./types";
import { WebSpeechAsr } from "./webspeech";

export async function getAsrProvider(): Promise<AsrProvider> {
  try {
    const res = await fetch("/api/config/asr", { cache: "no-store" });
    const data = await res.json();
    const provider = (data?.provider as AsrProviderKey | undefined) || (data?.asrWorkflow === "NOVA_SONIC" ? "NOVA_REALTIME" : "TRANSCRIBE");
    const failover = (data?.failover as "FIXED" | "AUTO_SWITCH") || "FIXED";
    // Use the unified createAsrProvider so behavior is consistent
    const inst = await createAsrProvider({ provider, language: String(data?.language || "en-US"), failover });
    // getAsrProvider historically returns AsrProvider; the instance implements that.
    return inst as unknown as AsrProvider;
  } catch {
    return new WebSpeechAsr();
  }
}
