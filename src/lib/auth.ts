import { auth, currentUser } from "@clerk/nextjs/server";

export async function requireAdmin() {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, status: 401 as const };
    const user = await currentUser();
    const role = (user?.publicMetadata as Record<string, unknown> | undefined)?.role as string | undefined;
    if (role === "admin") return { ok: true, userId } as const;
    return { ok: false, status: 403 as const };
  } catch {
    // If Clerk is not configured, deny access by default
    return { ok: false, status: 401 as const };
  }
}
