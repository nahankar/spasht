import { prisma } from "./prisma";

export async function cleanupOldData(days: number) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  // Delete events older than cutoff
  try {
    const model = (prisma as unknown as Record<string, unknown>)["sessionEvent"] as {
      deleteMany(args: { where: { ts: { lt: Date } } }): Promise<{ count: number }>;
    };
    await model.deleteMany({ where: { ts: { lt: cutoff } } });
  } catch {
    // If model missing (no migration), ignore
  }

  // Optionally delete completed sessions older than cutoff (keep if you need history)
  const res = await prisma.interviewSession.deleteMany({ where: { completedAt: { lt: cutoff } } });
  return { deletedSessions: res.count };
}
