import { auth as clerkAuth } from "@clerk/nextjs/server";

/**
 * Wrapper for Clerk's auth() that handles missing configuration gracefully
 */
export async function safeAuth() {
  try {
    const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    
    if (!publishableKey || publishableKey.includes('placeholder')) {
      console.log('⚠️ Clerk not configured - returning anonymous auth');
      return { userId: null };
    }
    
    return await clerkAuth();
  } catch (error) {
    console.warn('Auth error (likely Clerk not configured):', error);
    return { userId: null };
  }
}

