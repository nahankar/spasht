import { bedrockClient, AWS_CONFIG } from "@/lib/aws-client";
import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import type {
  CoachProvider,
  PartialUtterance,
  Nudge,
  CoachReport,
  NudgeType,
} from "./types";

// Minimal schema-safe extraction helper
function safeJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

type NovaMessage = { role: "system" | "user"; content: Array<{ text: string }> };
type NovaBody = { input: NovaMessage[]; inferenceConfig: { maxTokens: number; temperature: number } };

async function callNova(prompt: string, system?: string): Promise<string> {
  const msgs: NovaMessage[] = [
    ...(system ? [{ role: "system" as const, content: [{ text: system }] as Array<{ text: string }> }] : []),
    { role: "user" as const, content: [{ text: prompt }] },
  ];
  const body: NovaBody = {
    input: msgs,
    inferenceConfig: { maxTokens: 500, temperature: 0.3 },
  };

  const res = await bedrockClient.send(
    new InvokeModelCommand({
      modelId: AWS_CONFIG.BEDROCK_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(body),
    })
  );

  const json = res.body ? JSON.parse(new TextDecoder().decode(res.body)) : {};
  const text: string = json?.output?.[0]?.content?.[0]?.text ?? json?.outputText ?? "";
  return text;
}

export class BedrockNovaCoach implements CoachProvider {
  async getNudgesForPartial(input: PartialUtterance): Promise<Nudge[]> {
    const sys =
      "You are spasht, a concise real-time speaking coach for interviews. Return compact JSON only.";
    const prompt = `Given the partial transcript below, suggest at most 2 actionable nudges. Consider pace (${input.paceWpm ?? "na"} wpm), fillers (${input.fillerCount ?? 0}), and energy (${input.energyLevel ?? "na"}).\nTranscript: "${input.text}"\nOutput JSON schema: {"nudges":[{"type":"pace|clarity|filler|energy|brevity|pauses","message":"string","severity":"info|warn|critical"}]}\nRespond with JSON only.`;

    const text = await callNova(prompt, sys);
    const parsed = safeJson<{ nudges: Array<{ type: string; message: string; severity?: string }> }>(
      text,
      { nudges: [] }
    );

    const now = Date.now();
    const validTypes: NudgeType[] = ["pace", "clarity", "filler", "energy", "brevity", "pauses"];
    const validSeverity = ["info", "warn", "critical"] as const;
    return (parsed.nudges || []).slice(0, 2).map((n, i) => {
      const suggestedType = (typeof n.type === "string" && validTypes.includes(n.type as NudgeType))
        ? (n.type as NudgeType)
        : "clarity";
      const suggestedSeverity = (typeof n.severity === "string" && (validSeverity as readonly string[]).includes(n.severity))
        ? (n.severity as "info" | "warn" | "critical")
        : "info";
      return {
        id: `${now}-${i}`,
        type: suggestedType,
        message: n.message ?? "",
        severity: suggestedSeverity,
        timestamp: now,
      } satisfies Nudge;
    });
  }

  async getSessionReport(fullTranscript: string): Promise<CoachReport> {
    const sys =
      "You are spasht, a supportive interview coach. Produce a practical, concise JSON report. No extra text.";
    const prompt = `Analyze the interview transcript and return a JSON report with keys: summary (<=60 words), strengths (3), improvements (3), scores {fluency, clarity, confidence, fillerRate, paceWpm} numbers 0-100 except fillerRate and paceWpm as realistic numbers, and tips (3). Transcript:\n"""${fullTranscript}"""\nRespond with JSON only.`;

    const text = await callNova(prompt, sys);
    const fallback: CoachReport = {
      summary: "",
      strengths: [],
      improvements: [],
      scores: { fluency: 50, clarity: 50, confidence: 50, fillerRate: 0, paceWpm: 120 },
      tips: [],
    };
    return safeJson<CoachReport>(text, fallback);
  }
}
