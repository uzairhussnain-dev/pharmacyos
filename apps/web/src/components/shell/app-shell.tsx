'use client';

import React, { useEffect } from 'react';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { useAuth } from '@/lib/auth-context';
import { Skeleton } from '@/components/ui/skeleton';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isLoading, login } = useAuth();

  // If no user is logged in, auto-login as owner in demo mode so the UI is immediately interactive
  useEffect(() => {
    if (!isLoading && !user) {
      login('owner', 'Demo@12345').catch(() => undefined);
    }
  }, [isLoading, user, login]);

  if (isLoading && !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#F4F7F6]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#159A72] border-t-transparent" />
          <p className="text-sm font-semibold text-[#122A36]">Loading PharmacyOS...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F4F7F6]">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
