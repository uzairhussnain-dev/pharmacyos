'use client';

import React, { useState } from 'react';
import {
  LineChart as LineChartIcon,
  Calendar,
  TrendingUp,
  Percent,
  Boxes,
  AlertTriangle,
  Award,
  Hourglass,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/shell/app-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api-client';
import { formatPKR, formatDate } from '@/lib/utils';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';

export default function ReportsPage() {
  const [rangeDays, setRangeDays] = useState<number>(30);

  const fromDate = new Date(Date.now() - rangeDays * 86400_000).toISOString();
  const toDate = new Date().toISOString();

  // Queries
  const { data: gpData, isLoading: isGpLoading } = useQuery({
    queryKey: ['reports-gp', rangeDays],
    queryFn: () => api.reports.grossProfit({ from: fromDate, to: toDate }),
  });

  const { data: invVal } = useQuery({
    queryKey: ['reports-inv-val'],
    queryFn: () => api.reports.inventoryValue(),
  });

  const { data: expiryLoss } = useQuery({
    queryKey: ['reports-expiry-loss', rangeDays],
    queryFn: () => api.reports.expiryLoss({ from: fromDate, to: toDate }),
  });

  const { data: topProducts } = useQuery({
    queryKey: ['reports-top-products', rangeDays],
    queryFn: () => api.reports.topProducts({ from: fromDate, to: toDate, limit: 8 }),
  });

  const { data: slowMovers } = useQuery({
    queryKey: ['reports-slow-movers', rangeDays],
    queryFn: () => api.reports.slowMovers({ from: fromDate, to: toDate }),
  });

  const topChartData = (topProducts || []).map((p) => ({
    name: p.name.length > 12 ? `${p.name.slice(0, 12)}…` : p.name,
    Revenue: p.revenueMinor / 100,
    Profit: p.profitMinor / 100,
  }));

  const marginPercent = gpData?.marginBps ? (gpData.marginBps / 100).toFixed(1) : '0.0';

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#122A36]">
              Financial Reports & Authoritative Analytics
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Strict server-calculated gross profit, FEFO landed costs, and product velocity.
            </p>
          </div>

          {/* Date Filter Buttons */}
          <div className="flex items-center gap-1 rounded-lg border border-[#d1deda] bg-white p-1 text-xs font-semibold">
            {[7, 30, 60, 90].map((d) => (
              <button
                key={d}
                onClick={() => setRangeDays(d)}
                className={`rounded px-2.5 py-1 transition-colors ${
                  rangeDays === d
                    ? 'bg-[#159A72] text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Last {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Top Aggregates */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-[#d1deda]">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-semibold uppercase text-slate-500">
                Period Revenue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[#122A36]">
                {formatPKR(gpData?.salesMinor ?? 0)}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {gpData?.transactions ?? 0} confirmed transactions
              </p>
            </CardContent>
          </Card>

          <Card className="border-[#d1deda]">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-semibold uppercase text-slate-500">
                Gross Profit
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[#159A72]">
                {formatPKR(gpData?.grossProfitMinor ?? 0)}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Cost Basis: {formatPKR(gpData?.costMinor ?? 0)}
              </p>
            </CardContent>
          </Card>

          <Card className="border-[#d1deda]">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-semibold uppercase text-slate-500">
                Gross Margin
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[#122A36]">
                {marginPercent}%
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Weighted across all dispensed batches
              </p>
            </CardContent>
          </Card>

          <Card className="border-[#d1deda]">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-semibold uppercase text-slate-500">
                Total Stock Valuation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-700">
                {formatPKR(invVal?.totalCostValueMinor ?? 0)}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Retail Value: {formatPKR(invVal?.totalSellingValueMinor ?? 0)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Top Products Performance Chart */}
        <Card className="border-[#d1deda]">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-sm font-bold text-[#122A36]">
                Top Products by Revenue & Profit Margin
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Dispensed volume comparison across top community medicines (PKR).
              </CardDescription>
            </div>
            <Award className="h-4 w-4 text-[#159A72]" />
          </CardHeader>
          <CardContent>
            <div className="h-[280px] w-full pt-2">
              {topChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topChartData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5ece9" />
                    <XAxis dataKey="name" stroke="#8fa8b7" fontSize={11} interval={0} angle={-15} textAnchor="end" />
                    <YAxis
                      stroke="#8fa8b7"
                      fontSize={11}
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
                    <Legend />
                    <Bar dataKey="Revenue" fill="#159A72" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Profit" fill="#E8B04A" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-slate-400">
                  No sales data found for this period.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Grids: Top Products Table & Slow Movers Table */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Top Products */}
          <Card className="border-[#d1deda]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-[#122A36]">
                Top Sellers Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-center">Units Sold</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topProducts && topProducts.length > 0 ? (
                    topProducts.map((p) => (
                      <TableRow key={p.productId}>
                        <TableCell className="font-semibold text-xs text-[#122A36]">
                          {p.name}
                        </TableCell>
                        <TableCell className="text-center font-bold text-xs">
                          {p.unitsSold}
                        </TableCell>
                        <TableCell className="text-right font-medium text-xs">
                          {formatPKR(p.revenueMinor)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-xs text-[#159A72]">
                          {formatPKR(p.profitMinor)}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-xs text-slate-400">
                        No product rankings available.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Slow Movers */}
          <Card className="border-[#d1deda]">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold text-[#122A36]">
                  Slow-Moving Stock Warning
                </CardTitle>
                <Badge variant="warning" className="text-[10px]">
                  Working Capital Tied
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Medicine</TableHead>
                    <TableHead className="text-center">Stock Held</TableHead>
                    <TableHead className="text-center">Days Idle</TableHead>
                    <TableHead className="text-right">Capital Tied</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slowMovers && slowMovers.length > 0 ? (
                    slowMovers.map((s) => (
                      <TableRow key={s.productId}>
                        <TableCell className="font-semibold text-xs text-[#122A36]">
                          {s.name}
                        </TableCell>
                        <TableCell className="text-center font-bold text-xs">
                          {s.onHandUnits} units
                        </TableCell>
                        <TableCell className="text-center text-xs text-amber-700 font-bold">
                          {s.daysWithoutSale}d
                        </TableCell>
                        <TableCell className="text-right font-bold text-xs text-slate-700">
                          {formatPKR(s.stockValueMinor)}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-xs text-slate-400">
                        No slow-moving inventory detected.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
