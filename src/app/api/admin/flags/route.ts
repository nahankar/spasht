import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

const FlagsSchema = z.object({
  asrProvider: z.enum(["TRANSCRIBE", "NOVA_REALTIME", "WEBSPEECH_FALLBACK"]),
  failoverMode: z.enum(["FIXED", "AUTO_SWITCH"]),
  language: z.string().default("en-US"),
  nudgesRateLimitPerMin: z.number().int().min(1).max(120).default(20),
  reportPerSessionLimit: z.number().int().min(1).max(10).default(2),
  dataRetentionDays: z.number().int().min(7).max(3650).default(90),
  piiRedactionEnabled: z.boolean().default(false),
  auditEnabled: z.boolean().default(true),
});

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: "Unauthorized" }, { status: admin.status });
  const config = await prisma.featureConfig.findUnique({ where: { id: 1 } });
  if (!config) {
    // Initialize with defaults if not present
    const created = await prisma.featureConfig.create({
      data: { id: 1, updatedBy: admin.userId },
    });
    return NextResponse.json(created);
  }
  return NextResponse.json(config);
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: "Unauthorized" }, { status: admin.status });
  const body = await req.json();
  const parsed = FlagsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const updated = await prisma.featureConfig.upsert({
    where: { id: 1 },
    create: { id: 1, ...data, updatedBy: admin.userId },
    update: { ...data, updatedBy: admin.userId },
  });
  if (updated.auditEnabled) {
    await prisma.adminAudit.create({
      data: {
        actorId: admin.userId ?? "unknown",
        action: "UPDATE_FLAGS",
        details: data as unknown as object,
      },
    });
  }
  return NextResponse.json(updated);
}
