"use client";

import { ClerkProvider } from '@clerk/nextjs';
import React from 'react';

interface OptionalClerkProviderProps {
  children: React.ReactNode;
}

export function OptionalClerkProvider({ children }: OptionalClerkProviderProps) {
  // In development, if Clerk keys are not properly configured, just render children
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  
  if (!publishableKey || publishableKey.includes('placeholder')) {
    console.warn('⚠️ Clerk not configured - running without authentication');
    return <>{children}</>;
  }
  
  return (
    <ClerkProvider>
      {children}
    </ClerkProvider>
  );
}

