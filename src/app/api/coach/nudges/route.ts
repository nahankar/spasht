import { NextRequest, NextResponse } from "next/server";
import { getCoachProvider } from "@/core/coach/factory";
import { prisma } from "@/lib/prisma";
import { checkAndConsume } from "@/lib/rate-limit";
import { redactPII } from "@/lib/redact";

export async function POST(req: NextRequest) {
  try {
  const cfg = await prisma.featureConfig.findUnique({ where: { id: 1 } });
  const limit = cfg?.nudgesRateLimitPerMin ?? 20;
  const ip = req.headers.get("x-forwarded-for") || "anon";
  const rl = checkAndConsume(`nudges:${ip}`, limit, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    const body = await req.json();
    const { text, paceWpm, fillerCount, energyLevel, timestamp } = body || {};
    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }
    const safeText = cfg?.piiRedactionEnabled ? redactPII(text) : text;
    const provider = getCoachProvider();
    const nudges = await provider.getNudgesForPartial({
      text: safeText,
      paceWpm: typeof paceWpm === "number" ? paceWpm : undefined,
      fillerCount: typeof fillerCount === "number" ? fillerCount : undefined,
      energyLevel: typeof energyLevel === "number" ? energyLevel : undefined,
      timestamp: typeof timestamp === "number" ? timestamp : Date.now(),
    });
    return NextResponse.json({ nudges });
  } catch (err) {
    console.error("/api/coach/nudges error", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
