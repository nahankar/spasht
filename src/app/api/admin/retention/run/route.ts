import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cleanupOldData } from "@/lib/retention";

export async function POST() {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: "Unauthorized" }, { status: admin.status });
  const cfg = await prisma.featureConfig.findUnique({ where: { id: 1 } });
  const days = cfg?.dataRetentionDays ?? 90;
  const res = await cleanupOldData(days);
  return NextResponse.json({ ok: true, days, ...res });
}
