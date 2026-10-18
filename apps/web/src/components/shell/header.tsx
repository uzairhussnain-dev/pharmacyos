'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bell,
  ShoppingCart,
  CircleDollarSign,
  UserCheck,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

const titles: Record<string, { title: string; category: string }> = {
  '/': { title: 'Operational Dashboard', category: 'Overview' },
  '/pos': { title: 'Point of Sale Counter', category: 'Checkout' },
  '/products': { title: 'Product Catalog & Formulations', category: 'Pharmacy' },
  '/inventory': { title: 'Batch Inventory & Expiry Tracking', category: 'Operations' },
  '/purchasing': { title: 'Purchasing & Goods Receipts', category: 'Supply Chain' },
  '/sales': { title: 'Sales History & Returns', category: 'Transactions' },
  '/cash-sessions': { title: 'Cash Drawer Sessions', category: 'Finance' },
  '/customers': { title: 'Customers & Credit Ledger', category: 'Accounts' },
  '/finance': { title: 'Payables, Receivables & Expenses', category: 'Accounting' },
  '/reports': { title: 'Reports & Profit Margins', category: 'Analytics' },
  '/intelligence': { title: 'Action Center & Expiry Rescue', category: 'Alerts' },
  '/audit': { title: 'Audit Trail & Compliance', category: 'System' },
};

export function Header() {
  const pathname = usePathname();
  const { user, switchUser, hasPermission } = useAuth();

  // Find matching title
  const current = titles[pathname] || {
    title: pathname.replace('/', '').toUpperCase() || 'PharmacyOS',
    category: 'System',
  };

  // Check active cash session
  const { data: currentSession } = useQuery({
    queryKey: ['cash-session-current', user?.id],
    queryFn: () => api.cashSessions.current(),
    enabled: !!user && hasPermission('cash.session'),
    refetchInterval: 15000,
  });

  // Check open alerts count
  const { data: alertsData } = useQuery({
    queryKey: ['alerts-count'],
    queryFn: () => api.intelligence.listActions({ status: 'OPEN', pageSize: 1 }),
    enabled: !!user && hasPermission('intelligence.read'),
    refetchInterval: 30000,
  });

  const openAlertsCount = alertsData?.total ?? 0;

  return (
    <header className="sticky top-0 z-20 flex h-16 w-full items-center justify-between border-b border-[#d1deda] bg-white/95 px-6 backdrop-blur-xs">
      {/* Page Title & Breadcrumbs */}
      <div className="flex flex-col">
        <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
          <span>{current.category}</span>
          <span>/</span>
          <span className="text-[#159A72] font-semibold">{current.title}</span>
        </div>
        <h1 className="text-lg font-bold text-[#122A36] tracking-tight leading-none mt-0.5">
          {current.title}
        </h1>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        {/* Cash Drawer Session Status */}
        {hasPermission('cash.session') && (
          <Link href="/cash-sessions">
            <div
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                currentSession
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
              }`}
            >
              <CircleDollarSign className="h-4 w-4" />
              <span>
                {currentSession ? 'Drawer Open' : 'No Open Session'}
              </span>
              <span
                className={`h-2 w-2 rounded-full ${
                  currentSession ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                }`}
              />
            </div>
          </Link>
        )}

        {/* Action Center / Alert Notification */}
        {hasPermission('intelligence.read') && (
          <Link href="/intelligence">
            <Button
              variant="outline"
              size="sm"
              className="relative gap-1.5 text-xs border-[#d1deda]"
            >
              <Bell className="h-3.5 w-3.5 text-slate-600" />
              <span>Action Center</span>
              {openAlertsCount > 0 && (
                <Badge
                  variant="destructive"
                  className="ml-1 h-4 min-w-4 px-1 py-0 text-[10px] font-bold leading-none justify-center rounded-full"
                >
                  {openAlertsCount}
                </Badge>
              )}
            </Button>
          </Link>
        )}

        {/* POS Quick Button if not currently on POS */}
        {pathname !== '/pos' && hasPermission('pos.sell') && (
          <Link href="/pos">
            <Button size="sm" className="gap-2 bg-[#159A72] text-white hover:bg-[#128361]">
              <ShoppingCart className="h-4 w-4" />
              <span>POS (F2)</span>
            </Button>
          </Link>
        )}

        {/* Role Switcher for verification and pairing */}
        <div className="flex items-center gap-1.5 border-l border-slate-200 pl-3">
          <UserCheck className="h-4 w-4 text-slate-400" />
          <select
            className="rounded-md border border-[#d1deda] bg-white py-1 px-2 text-xs font-medium text-[#122A36] focus:outline-none focus:ring-1 focus:ring-[#159A72]"
            value={user?.username || ''}
            onChange={(e) => switchUser(e.target.value)}
            title="Switch demo account"
          >
            <option value="owner">Dr. Ayesha (Owner)</option>
            <option value="manager">Bilal Ahmed (Manager)</option>
            <option value="pharmacist">Sana Malik (Pharmacist)</option>
            <option value="cashier">Usman Tariq (Cashier)</option>
            <option value="stock">Kamran Shah (Stock Mgr)</option>
          </select>
        </div>
      </div>
    </header>
  );
}
