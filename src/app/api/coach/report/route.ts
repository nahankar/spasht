import { NextRequest, NextResponse } from "next/server";
import { getCoachProvider } from "@/core/coach/factory";
import { prisma } from "@/lib/prisma";
import { checkAndConsume } from "@/lib/rate-limit";
import { redactPII } from "@/lib/redact";

export async function POST(req: NextRequest) {
  try {
  const cfg = await prisma.featureConfig.findUnique({ where: { id: 1 } });
  const limit = cfg?.reportPerSessionLimit ?? 2;
  const ip = req.headers.get("x-forwarded-for") || "anon";
  const rl = checkAndConsume(`report:${ip}`, limit, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    const body = await req.json();
  const { transcript } = body || {};
    if (!transcript || typeof transcript !== "string") {
      return NextResponse.json({ error: "Missing transcript" }, { status: 400 });
    }
  const safeTranscript = cfg?.piiRedactionEnabled ? redactPII(transcript) : transcript;
    const provider = getCoachProvider();
  const report = await provider.getSessionReport(safeTranscript);
    return NextResponse.json({ report });
  } catch (err) {
    console.error("/api/coach/report error", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
