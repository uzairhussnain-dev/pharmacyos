'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Lock, User, ArrowRight, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

export default function LoginPage() {
  const router = useRouter();
  const { login, isLoading } = useAuth();
  const [username, setUsername] = useState('owner');
  const [password, setPassword] = useState('Demo@12345');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(username, password);
      router.push('/');
    } catch {
      // Error handled in AuthContext
    }
  };

  const quickLogin = async (userRole: string) => {
    try {
      await login(userRole, 'Demo@12345');
      router.push('/');
    } catch {
      // Error handled in AuthContext
    }
  };

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-[#F4F7F6] p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Brand */}
        <div className="flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#159A72] text-white shadow-md mb-3">
            <Sparkles className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#122A36]">
            Pharmacy<span className="text-[#159A72]">OS</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Community Pharmacy Point of Sale & Batch Inventory System
          </p>
        </div>

        {/* Login Card */}
        <Card className="border-[#d1deda] shadow-sm">
          <CardHeader className="pb-3 text-center">
            <CardTitle className="text-base font-bold text-[#122A36]">Sign in to your account</CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Enter your staff credentials to access your session.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700">Username</label>
                <div className="relative mt-1">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="pl-9 text-xs"
                    placeholder="e.g. owner or cashier"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Password</label>
                <div className="relative mt-1">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-9 text-xs"
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full bg-[#159A72] text-white hover:bg-[#128361] font-bold text-xs h-10 mt-2"
              >
                {isLoading ? 'Signing In...' : 'Sign In'}
              </Button>
            </form>

            {/* Quick Demo Logins */}
            <div className="border-t border-slate-100 pt-4">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-2 text-center">
                Quick 1-Click Demo Logins
              </span>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'owner', label: 'Dr. Ayesha (Owner)', role: 'OWNER' },
                  { id: 'manager', label: 'Bilal (Manager)', role: 'MANAGER' },
                  { id: 'pharmacist', label: 'Sana (Pharmacist)', role: 'PHARMACIST' },
                  { id: 'cashier', label: 'Usman (Cashier)', role: 'CASHIER' },
                ].map((demo) => (
                  <button
                    key={demo.id}
                    type="button"
                    onClick={() => quickLogin(demo.id)}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-left hover:bg-slate-100 hover:border-[#159A72] transition-colors"
                  >
                    <div className="font-bold text-xs text-[#122A36]">{demo.label}</div>
                    <div className="text-[10px] text-[#159A72] font-semibold">{demo.role}</div>
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Trust & Security Badge */}
        <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
          <ShieldCheck className="h-4 w-4 text-[#159A72]" />
          <span>Role-Based Permissions & Audit Enforced</span>
        </div>
      </div>
    </div>
  );
}
