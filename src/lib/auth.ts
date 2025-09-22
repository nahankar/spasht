import { currentUser } from "@clerk/nextjs/server";
import { safeAuth } from "@/lib/auth-wrapper";

export async function requireAdmin() {
  try {
    const { userId } = await safeAuth();
    if (!userId) return { ok: false, status: 401 as const };
    
    // If Clerk is not configured, safeAuth returns null userId
    const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    if (!publishableKey || publishableKey.includes('placeholder')) {
      return { ok: false, status: 401 as const };
    }
    
    const user = await currentUser();
    const role = (user?.publicMetadata as Record<string, unknown> | undefined)?.role as string | undefined;
    if (role === "admin") return { ok: true, userId } as const;
    return { ok: false, status: 403 as const };
  } catch {
    // If Clerk is not configured, deny access by default
    return { ok: false, status: 401 as const };
  }
}
