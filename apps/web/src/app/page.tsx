'use client';

import React from 'react';
import Link from 'next/link';
import {
  TrendingUp,
  Receipt,
  AlertTriangle,
  Clock,
  Sparkles,
  ArrowUpRight,
  Boxes,
  CircleDollarSign,
  PlusCircle,
  PackageCheck,
  ShieldCheck,
  Calendar,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/shell/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { formatPKR, formatPKRCompact, formatDate } from '@/lib/utils';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

export default function DashboardPage() {
  // Fetch real Dashboard KPIs from backend
  const { data: dashboard, isLoading: isDashLoading } = useQuery({
    queryKey: ['reports-dashboard'],
    queryFn: () => api.reports.dashboard(),
    refetchInterval: 30000,
  });

  // Fetch 14-day sales trend from backend
  const { data: salesTrend, isLoading: isTrendLoading } = useQuery({
    queryKey: ['reports-sales-trend'],
    queryFn: async () => {
      const from = new Date(Date.now() - 14 * 86400_000).toISOString();
      return api.reports.sales({ from });
    },
  });

  // Fetch Expiry Risk items
  const { data: expiryItems } = useQuery({
    queryKey: ['inventory-expiry-risk'],
    queryFn: () => api.inventory.expiryRisk(90),
  });

  // Fetch Stockout Risk items
  const { data: stockoutItems } = useQuery({
    queryKey: ['inventory-stockout-risk'],
    queryFn: () => api.inventory.stockoutRisk(),
  });

  // Fetch Recent Sales
  const { data: recentSales } = useQuery({
    queryKey: ['recent-sales'],
    queryFn: () => api.sales.list({ pageSize: 5 }),
  });

  // Fetch Action Center Alerts
  const { data: alerts } = useQuery({
    queryKey: ['high-priority-alerts'],
    queryFn: () => api.intelligence.listActions({ status: 'OPEN', pageSize: 4 }),
  });

  const chartData = (salesTrend?.series || []).map((s) => ({
    date: s.period ? formatDate(s.period).split(' ').slice(0, 2).join(' ') : '',
    sales: (s.totalMinor ?? s.grossMinor ?? 0) / 100,
    profit: ((s.totalMinor ?? s.grossMinor ?? 0) - (s.costMinor ?? 0)) / 100,
  }));

  const todayMargin = dashboard?.today.marginBps ? (dashboard.today.marginBps / 100).toFixed(1) : '0.0';

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Top Operational Bar & Quick Actions */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#122A36]">Pharmacy Overview</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live metrics from local pharmacy database & verified transaction records.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/pos">
              <Button size="sm" className="gap-2 bg-[#159A72] text-white hover:bg-[#128361] font-semibold">
                <Receipt className="h-4 w-4" />
                <span>Launch POS (F2)</span>
              </Button>
            </Link>
            <Link href="/purchasing">
              <Button size="sm" variant="outline" className="gap-2 border-[#d1deda]">
                <PackageCheck className="h-4 w-4 text-[#159A72]" />
                <span>Receive Stock</span>
              </Button>
            </Link>
            <Link href="/reports">
              <Button size="sm" variant="outline" className="gap-2 border-[#d1deda]">
                <TrendingUp className="h-4 w-4 text-slate-600" />
                <span>P&L Reports</span>
              </Button>
            </Link>
          </div>
        </div>

        {/* Real KPI Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Today's Sales */}
          <Card className="border-[#d1deda]">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Today's Sales
              </CardTitle>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-[#159A72]">
                <Receipt className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              {isDashLoading ? (
                <Skeleton className="h-8 w-28" />
              ) : (
                <>
                  <div className="text-2xl font-bold text-[#122A36]">
                    {formatPKR(dashboard?.today.salesMinor ?? 0)}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                    <span className="font-semibold text-emerald-600">
                      {dashboard?.today.transactions ?? 0} bills
                    </span>
                    <span>•</span>
                    <span>Yesterday: {formatPKR(dashboard?.yesterday.salesMinor ?? 0)}</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Gross Profit & Margin */}
          <Card className="border-[#d1deda]">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Gross Profit
              </CardTitle>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-[#159A72]">
                <TrendingUp className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              {isDashLoading ? (
                <Skeleton className="h-8 w-28" />
              ) : (
                <>
                  <div className="text-2xl font-bold text-[#122A36]">
                    {formatPKR(dashboard?.today.grossProfitMinor ?? 0)}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500">
                    <Badge variant="default" className="text-[10px] py-0 px-1 font-bold">
                      {todayMargin}% Margin
                    </Badge>
                    <span>calculated from FEFO batch costs</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Inventory Valuation */}
          <Card className="border-[#d1deda]">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Inventory Valuation
              </CardTitle>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Boxes className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              {isDashLoading ? (
                <Skeleton className="h-8 w-28" />
              ) : (
                <>
                  <div className="text-2xl font-bold text-[#122A36]">
                    {formatPKR(dashboard?.inventoryCostValueMinor ?? 0)}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                    <span>At landed purchase cost</span>
                    <span>•</span>
                    <Link href="/inventory" className="text-[#159A72] hover:underline font-medium">
                      Batches &rarr;
                    </Link>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Cash Drawer Status */}
          <Card className="border-[#d1deda]">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Active Drawer Sessions
              </CardTitle>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                <CircleDollarSign className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              {isDashLoading ? (
                <Skeleton className="h-8 w-28" />
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <div className="text-2xl font-bold text-[#122A36]">
                      {dashboard?.openCashSessions ?? 0}
                    </div>
                    <Badge
                      variant={dashboard?.openCashSessions ? 'success' : 'warning'}
                      className="text-[10px]"
                    >
                      {dashboard?.openCashSessions ? 'Sessions Active' : 'All Closed'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                    <Link href="/cash-sessions" className="text-[#159A72] hover:underline font-medium">
                      Manage Cash Sessions &rarr;
                    </Link>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sales Trend Chart & Action Center */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* 14-Day Sales & Profit Chart */}
          <Card className="lg:col-span-2 border-[#d1deda]">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold text-[#122A36]">
                  14-Day Revenue & Gross Profit Trend
                </CardTitle>
                <CardDescription className="text-xs text-slate-500">
                  Aggregated from transactional sales history (values in PKR).
                </CardDescription>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1.5 text-slate-600">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#159A72]" />
                  Sales
                </span>
                <span className="flex items-center gap-1.5 text-slate-600">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#E8B04A]" />
                  Profit
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[260px] w-full pt-2">
                {isTrendLoading ? (
                  <Skeleton className="h-full w-full" />
                ) : chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#159A72" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#159A72" stopOpacity={0.0} />
                        </linearGradient>
                        <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#E8B04A" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#E8B04A" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5ece9" />
                      <XAxis
                        dataKey="date"
                        stroke="#8fa8b7"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke="#8fa8b7"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `Rs. ${(v / 1000).toFixed(0)}k`}
                      />
                      <Tooltip
                        formatter={(val: any) => [`Rs. ${Number(val).toLocaleString()}`, '']}
                        contentStyle={{
                          backgroundColor: '#122A36',
                          borderColor: '#264a5c',
                          borderRadius: '8px',
                          color: '#fff',
                          fontSize: '12px',
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="sales"
                        name="Sales (PKR)"
                        stroke="#159A72"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#salesGrad)"
                      />
                      <Area
                        type="monotone"
                        dataKey="profit"
                        name="Gross Profit (PKR)"
                        stroke="#E8B04A"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#profitGrad)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-slate-400">
                    No sales recorded in the past 14 days.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Action Center High Priority Feed */}
          <Card className="border-[#d1deda]">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold text-[#122A36]">Action Center</CardTitle>
                <CardDescription className="text-xs text-slate-500">
                  Priority warnings and expiry rescues.
                </CardDescription>
              </div>
              <Link href="/intelligence">
                <Button variant="ghost" size="sm" className="h-7 text-xs text-[#159A72]">
                  View All &rarr;
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {alerts?.items && alerts.items.length > 0 ? (
                  alerts.items.map((alert) => (
                    <div
                      key={alert.id}
                      className="flex flex-col gap-1 rounded-lg border border-[#e2ede9] bg-[#f8faf9] p-3 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-[#122A36] truncate">{alert.title}</span>
                        <Badge
                          variant={
                            alert.severity === 'CRITICAL' || alert.severity === 'HIGH'
                              ? 'destructive'
                              : 'warning'
                          }
                          className="text-[10px] py-0 px-1"
                        >
                          {alert.severity}
                        </Badge>
                      </div>
                      <p className="text-slate-600 line-clamp-2 leading-relaxed">
                        {alert.explanation}
                      </p>
                      {alert.estimatedImpactMinor && (
                        <div className="mt-1 flex items-center gap-1 font-semibold text-rose-700">
                          <span>Risk: {formatPKR(alert.estimatedImpactMinor)}</span>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center text-slate-400">
                    <ShieldCheck className="h-8 w-8 text-[#159A72] mb-2" />
                    <p className="text-xs font-semibold text-[#122A36]">All Clear</p>
                    <p className="text-[11px] text-slate-500">No open risk alerts at this time.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Operational Grid: Expiry Watch, Low Stock & Recent Sales */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Expiry Risk Items */}
          <Card className="border-[#d1deda]">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-sm font-bold text-[#122A36]">Expiry Watch (90 Days)</CardTitle>
                <CardDescription className="text-xs text-slate-500">
                  Batches nearing expiry date.
                </CardDescription>
              </div>
              <Link href="/inventory">
                <Button variant="ghost" size="sm" className="h-7 text-xs text-[#159A72]">
                  Batches &rarr;
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {expiryItems && expiryItems.length > 0 ? (
                  expiryItems.slice(0, 5).map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-lg border border-[#e8f0ec] p-2.5 text-xs hover:bg-[#f6faf8]"
                    >
                      <div>
                        <div className="font-semibold text-[#122A36]">{item.name}</div>
                        <div className="text-[11px] text-slate-500">
                          Batch: <span className="font-mono text-slate-700">{item.batchNumber}</span> • {item.onHandUnits} units
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge variant="destructive" className="text-[10px]">
                          Exp: {formatDate(item.expiryDate)}
                        </Badge>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="py-6 text-center text-xs text-slate-400">
                    No batches expiring within 90 days.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Stockout Risk & Reorders */}
          <Card className="border-[#d1deda]">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-sm font-bold text-[#122A36]">Low Stock & Reorders</CardTitle>
                <CardDescription className="text-xs text-slate-500">
                  Items below configured safety thresholds.
                </CardDescription>
              </div>
              <Link href="/purchasing">
                <Button variant="ghost" size="sm" className="h-7 text-xs text-[#159A72]">
                  Create PO &rarr;
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {stockoutItems && stockoutItems.length > 0 ? (
                  stockoutItems.slice(0, 5).map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-lg border border-[#e8f0ec] p-2.5 text-xs hover:bg-[#f6faf8]"
                    >
                      <div>
                        <div className="font-semibold text-[#122A36]">{item.name}</div>
                        <div className="text-[11px] text-slate-500">
                          On Hand: <span className="font-bold text-rose-700">{item.onHandUnits}</span> / Safety: {item.reorderLevel}
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge variant="warning" className="text-[10px]">
                          ~{item.daysRemaining} days left
                        </Badge>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="py-6 text-center text-xs text-slate-400">
                    All inventory levels are above safety stock.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Recent Sales Activity */}
          <Card className="border-[#d1deda]">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-sm font-bold text-[#122A36]">Recent Transactions</CardTitle>
                <CardDescription className="text-xs text-slate-500">
                  Latest customer purchases.
                </CardDescription>
              </div>
              <Link href="/sales">
                <Button variant="ghost" size="sm" className="h-7 text-xs text-[#159A72]">
                  All Sales &rarr;
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {recentSales?.items && recentSales.items.length > 0 ? (
                  recentSales.items.map((sale) => (
                    <div
                      key={sale.id}
                      className="flex items-center justify-between rounded-lg border border-[#e8f0ec] p-2.5 text-xs hover:bg-[#f6faf8]"
                    >
                      <div>
                        <div className="font-semibold text-[#122A36]">
                          {sale.invoiceNumber}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {sale.lines.length} items • {sale.cashierName || 'Cashier'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-[#122A36]">
                          {formatPKR(sale.totalMinor)}
                        </div>
                        <span className="text-[10px] text-slate-400 font-medium">
                          {sale.payments?.[0]?.method || 'CASH'}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="py-6 text-center text-xs text-slate-400">
                    No recent transactions found.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
