'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ShoppingCart,
  Pill,
  Boxes,
  Truck,
  Receipt,
  CircleDollarSign,
  Users,
  LineChart,
  ShieldAlert,
  History,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  LogOut,
  Building2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';
import type { Permission } from '@pharmacy-os/shared-types';

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: Permission;
  badge?: string;
  isSpecial?: boolean;
}

const navItems: NavItem[] = [
  {
    title: 'POS Counter',
    href: '/pos',
    icon: ShoppingCart,
    permission: 'pos.sell',
    badge: 'F2',
    isSpecial: true,
  },
  {
    title: 'Dashboard',
    href: '/',
    icon: LayoutDashboard,
    permission: 'reports.read',
  },
  {
    title: 'Products',
    href: '/products',
    icon: Pill,
    permission: 'products.read',
  },
  {
    title: 'Inventory & Batches',
    href: '/inventory',
    icon: Boxes,
    permission: 'inventory.read',
  },
  {
    title: 'Purchasing & Suppliers',
    href: '/purchasing',
    icon: Truck,
    permission: 'purchasing.read',
  },
  {
    title: 'Sales & Receipts',
    href: '/sales',
    icon: Receipt,
    permission: 'sales.read',
  },
  {
    title: 'Cash Drawer',
    href: '/cash-sessions',
    icon: CircleDollarSign,
    permission: 'cash.session',
  },
  {
    title: 'Customers & Credit',
    href: '/customers',
    icon: Users,
    permission: 'customers.read',
  },
  {
    title: 'Finance & Expenses',
    href: '/finance',
    icon: Building2,
    permission: 'finance.read',
  },
  {
    title: 'Reports & P&L',
    href: '/reports',
    icon: LineChart,
    permission: 'reports.read',
  },
  {
    title: 'Action Center',
    href: '/intelligence',
    icon: ShieldAlert,
    permission: 'intelligence.read',
    badge: 'Alerts',
  },
  {
    title: 'Audit Trail',
    href: '/audit',
    icon: History,
    permission: 'audit.read',
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, hasPermission, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        'relative flex flex-col border-r border-[#1e3e4e] bg-[#122A36] text-white transition-all duration-300 ease-in-out shrink-0 select-none z-30',
        collapsed ? 'w-18' : 'w-64'
      )}
    >
      {/* Brand Header */}
      <div className="flex h-16 items-center justify-between px-4 border-b border-[#1b3a4a]">
        <Link href="/" className="flex items-center gap-2.5 overflow-hidden">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#159A72] text-white font-bold text-lg shadow-sm">
            <Sparkles className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="font-bold tracking-tight text-white text-base leading-none">
                Pharmacy<span className="text-[#159A72]">OS</span>
              </span>
              <span className="text-[10px] uppercase font-semibold text-[#8fa8b7] tracking-wider mt-0.5">
                Community Rx
              </span>
            </div>
          )}
        </Link>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[#8fa8b7] hover:bg-[#1b3a4a] hover:text-white transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
        {navItems.map((item) => {
          if (item.permission && !hasPermission(item.permission)) {
            return null;
          }

          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
                item.isSpecial
                  ? isActive
                    ? 'bg-[#159A72] text-white font-semibold shadow-sm'
                    : 'bg-[#159A72]/20 text-emerald-300 hover:bg-[#159A72]/30 hover:text-white border border-[#159A72]/30'
                  : isActive
                  ? 'bg-[#1b3a4a] text-white font-semibold shadow-xs'
                  : 'text-[#a2bac7] hover:bg-[#173342] hover:text-white'
              )}
              title={collapsed ? item.title : undefined}
            >
              <item.icon
                className={cn(
                  'h-5 w-5 shrink-0 transition-transform group-hover:scale-105',
                  isActive
                    ? item.isSpecial
                      ? 'text-white'
                      : 'text-[#159A72]'
                    : item.isSpecial
                    ? 'text-emerald-400'
                    : 'text-[#8fa8b7]'
                )}
              />
              {!collapsed && (
                <div className="flex flex-1 items-center justify-between overflow-hidden">
                  <span className="truncate">{item.title}</span>
                  {item.badge && (
                    <span
                      className={cn(
                        'ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                        item.isSpecial
                          ? 'bg-emerald-950/60 text-emerald-200 border border-emerald-700/50'
                          : 'bg-[#122A36] text-[#E8B04A] border border-[#E8B04A]/30'
                      )}
                    >
                      {item.badge}
                    </span>
                  )}
                </div>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom User Area */}
      <div className="border-t border-[#1b3a4a] p-3">
        {user ? (
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1b3a4a] font-semibold text-xs text-emerald-400 border border-[#2a5063]">
              {user.name
                .split(' ')
                .map((n) => n[0])
                .slice(0, 2)
                .join('')}
            </div>
            {!collapsed && (
              <div className="flex flex-1 flex-col overflow-hidden">
                <span className="truncate text-xs font-semibold text-white">{user.name}</span>
                <span className="text-[10px] font-medium text-emerald-400 uppercase tracking-wider">
                  {user.role}
                </span>
              </div>
            )}
            <button
              onClick={() => logout()}
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-[#8fa8b7] hover:bg-[#1b3a4a] hover:text-rose-400 transition-colors"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="flex items-center justify-center rounded-lg bg-[#159A72] py-2 text-xs font-semibold text-white hover:bg-[#128361]"
          >
            {!collapsed ? 'Sign In' : <Sparkles className="h-4 w-4" />}
          </Link>
        )}
      </div>
    </aside>
  );
}
