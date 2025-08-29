import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-store";

export async function GET() {
  // Try DB-backed flags first
  try {
    const cfg = await prisma.featureConfig.findUnique({ where: { id: 1 } });
    if (cfg) {
      const provider = cfg.asrProvider; // "TRANSCRIBE" | "NOVA_REALTIME" | "WEBSPEECH_FALLBACK"
      const failover = cfg.failoverMode; // "FIXED" | "AUTO_SWITCH"
      const language = cfg.language;
      // Back-compat key for older client function
      const asrWorkflow = provider === "NOVA_REALTIME" ? "NOVA_SONIC" : "TRANSCRIBE";
      return NextResponse.json({ provider, failover, language, asrWorkflow });
    }
  } catch {
    // ignore and fallback
  }
  // Fallback to file store
  const { asrWorkflow } = loadSettings();
  const provider = asrWorkflow === "NOVA_SONIC" ? "NOVA_REALTIME" : "TRANSCRIBE";
  const failover = "FIXED" as const;
  const language = "en-US";
  return NextResponse.json({ provider, failover, language, asrWorkflow });
}
