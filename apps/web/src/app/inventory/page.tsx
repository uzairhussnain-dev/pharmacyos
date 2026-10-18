'use client';

import React, { useState } from 'react';
import {
  Boxes,
  Calendar,
  AlertTriangle,
  ArrowUpDown,
  Filter,
  CheckCircle,
  FileText,
  Sliders,
  ShieldAlert,
  Search,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/shell/app-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { api } from '@/lib/api-client';
import { formatPKR, formatDate } from '@/lib/utils';
import { toast } from 'sonner';
import type { BatchDto, StockMovementDto } from '@pharmacy-os/shared-types';

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'batches' | 'movements' | 'counts'>('batches');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);

  // Stock Adjustment Modal
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<BatchDto | null>(null);
  const [adjustQty, setAdjustQty] = useState<number>(1);
  const [adjustReason, setAdjustReason] = useState<string>('');
  const [adjustType, setAdjustType] = useState<'WRITE_OFF' | 'ADJUSTMENT'>('WRITE_OFF');

  // Change Batch Status Modal
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<string>('QUARANTINED');

  // Fetch Inventory Summary
  const { data: summary } = useQuery({
    queryKey: ['inventory-summary'],
    queryFn: () => api.inventory.summary(),
  });

  // Fetch Batches
  const { data: batchesData, isLoading: isBatchesLoading } = useQuery({
    queryKey: ['inventory-batches', statusFilter, page],
    queryFn: () =>
      api.inventory.batches({
        status: statusFilter || undefined,
        page,
        pageSize: 15,
      }),
    enabled: activeTab === 'batches',
  });

  // Fetch Stock Movements
  const { data: movementsData, isLoading: isMovementsLoading } = useQuery({
    queryKey: ['inventory-movements', page],
    queryFn: () =>
      api.inventory.movements({
        page,
        pageSize: 15,
      }),
    enabled: activeTab === 'movements',
  });

  // Fetch Cyclic Stock Counts
  const { data: countsData, isLoading: isCountsLoading } = useQuery({
    queryKey: ['inventory-counts', page],
    queryFn: () =>
      api.inventory.counts({
        page,
        pageSize: 15,
      }),
    enabled: activeTab === 'counts',
  });

  // Stock Adjustment Mutation
  const adjustMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBatch) return;
      return api.inventory.adjust({
        batchId: selectedBatch.id,
        quantityUnits: adjustQty,
        type: adjustType,
        reason: adjustReason,
      });
    },
    onSuccess: () => {
      toast.success('Stock adjustment recorded in ledger');
      setAdjustModalOpen(false);
      setSelectedBatch(null);
      setAdjustReason('');
      queryClient.invalidateQueries({ queryKey: ['inventory-batches'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-summary'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to adjust stock');
    },
  });

  // Set Batch Status Mutation
  const setStatusMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBatch) return;
      return api.inventory.setBatchStatus(selectedBatch.id, {
        status: newStatus,
        reason: 'Updated from management dashboard',
      });
    },
    onSuccess: () => {
      toast.success(`Batch status updated to ${newStatus}`);
      setStatusModalOpen(false);
      setSelectedBatch(null);
      queryClient.invalidateQueries({ queryKey: ['inventory-batches'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to update batch status');
    },
  });

  // Calculate days remaining until expiry
  const getDaysUntilExpiry = (expiryDate: string) => {
    const diff = new Date(expiryDate).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 3600 * 24));
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Top Header & Metrics */}
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#122A36]">
            Batch-Level Inventory & FEFO Ledger
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Every physical medicine unit tracked by lot number, landed cost, and expiration date.
          </p>
        </div>

        {/* Inventory Summary Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-[#d1deda]">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-semibold uppercase text-slate-500">
                Total Physical Batches
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[#122A36]">
                {summary?.totalBatches ?? 0}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {summary?.totalUnits ?? 0} total units in stock
              </p>
            </CardContent>
          </Card>

          <Card className="border-[#d1deda]">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-semibold uppercase text-slate-500">
                Inventory Valuation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[#159A72]">
                {formatPKR(summary?.costValueMinor ?? 0)}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Exact landed purchase cost
              </p>
            </CardContent>
          </Card>

          <Card className="border-[#d1deda]">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-semibold uppercase text-slate-500">
                Expiring in 30 Days
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <div className="text-2xl font-bold text-amber-600">
                  {summary?.expiringWithin30Days ?? 0}
                </div>
                {(summary?.expiringWithin30Days ?? 0) > 0 && (
                  <Badge variant="warning" className="text-[10px]">
                    Action Needed
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Nearing expiry threshold
              </p>
            </CardContent>
          </Card>

          <Card className="border-[#d1deda]">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-semibold uppercase text-slate-500">
                Expired Stock
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <div className="text-2xl font-bold text-rose-600">
                  {summary?.expiredUnits ?? 0} units
                </div>
                {(summary?.expiredUnits ?? 0) > 0 && (
                  <Badge variant="destructive" className="text-[10px]">
                    Requires Write-off
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Blocked from POS sale
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Tab Controls */}
        <div className="flex border-b border-[#d1deda] gap-6 text-sm font-semibold">
          <button
            onClick={() => {
              setActiveTab('batches');
              setPage(1);
            }}
            className={`pb-3 transition-colors ${
              activeTab === 'batches'
                ? 'border-b-2 border-[#159A72] text-[#159A72]'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Active Batches & Expiry
          </button>
          <button
            onClick={() => {
              setActiveTab('movements');
              setPage(1);
            }}
            className={`pb-3 transition-colors ${
              activeTab === 'movements'
                ? 'border-b-2 border-[#159A72] text-[#159A72]'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Double-Entry Stock Movements
          </button>
          <button
            onClick={() => {
              setActiveTab('counts');
              setPage(1);
            }}
            className={`pb-3 transition-colors ${
              activeTab === 'counts'
                ? 'border-b-2 border-[#159A72] text-[#159A72]'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Cyclic Physical Counts
          </button>
        </div>

        {/* TAB 1: Batches Table */}
        {activeTab === 'batches' && (
          <div className="space-y-4">
            {/* Filter Bar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-slate-400" />
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(1);
                  }}
                  className="rounded-lg border border-[#d1deda] bg-white py-1.5 px-3 text-xs font-medium text-[#122A36]"
                >
                  <option value="">All Batch Statuses</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="QUARANTINED">QUARANTINED</option>
                  <option value="EXPIRED">EXPIRED</option>
                  <option value="DEPLETED">DEPLETED</option>
                </select>
              </div>
            </div>

            <Card className="border-[#d1deda]">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Batch Lot #</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Expiry Date</TableHead>
                      <TableHead className="text-right">Unit Purchase Cost</TableHead>
                      <TableHead className="text-center">On Hand</TableHead>
                      <TableHead className="text-center">Reserved</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isBatchesLoading ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-xs text-slate-400">
                          Loading batches...
                        </TableCell>
                      </TableRow>
                    ) : batchesData?.items && batchesData.items.length > 0 ? (
                      batchesData.items.map((batch) => {
                        const daysLeft = getDaysUntilExpiry(batch.expiryDate);
                        const isExpired = daysLeft <= 0;
                        const isNearExpiry = daysLeft > 0 && daysLeft <= 90;

                        return (
                          <TableRow key={batch.id}>
                            <TableCell className="font-mono font-bold text-xs text-[#122A36]">
                              {batch.batchNumber}
                            </TableCell>
                            <TableCell>
                              <div className="font-semibold text-xs text-[#122A36]">
                                {batch.product?.brandName || 'Product'}
                              </div>
                              <div className="text-[11px] text-slate-500 font-mono">
                                SKU: {batch.product?.sku}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="text-xs font-medium">
                                {formatDate(batch.expiryDate)}
                              </div>
                              <div className="mt-0.5">
                                {isExpired ? (
                                  <Badge variant="destructive" className="text-[10px] py-0 px-1 font-bold">
                                    EXPIRED
                                  </Badge>
                                ) : isNearExpiry ? (
                                  <Badge variant="warning" className="text-[10px] py-0 px-1 font-bold">
                                    {daysLeft} days left
                                  </Badge>
                                ) : (
                                  <span className="text-[10px] text-slate-400">
                                    {daysLeft} days left
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-semibold text-xs text-slate-700">
                              {formatPKR(batch.purchaseCostMinor)}
                            </TableCell>
                            <TableCell className="text-center font-bold text-xs">
                              {batch.onHandUnits}
                            </TableCell>
                            <TableCell className="text-center text-xs text-slate-500">
                              {batch.reservedUnits}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  batch.status === 'ACTIVE'
                                    ? 'success'
                                    : batch.status === 'QUARANTINED'
                                    ? 'warning'
                                    : 'destructive'
                                }
                                className="text-[10px]"
                              >
                                {batch.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedBatch(batch);
                                    setAdjustQty(Math.min(batch.onHandUnits, 1));
                                    setAdjustModalOpen(true);
                                  }}
                                  className="h-7 text-xs border-[#d1deda]"
                                >
                                  Adjust
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedBatch(batch);
                                    setNewStatus(batch.status);
                                    setStatusModalOpen(true);
                                  }}
                                  className="h-7 text-xs text-slate-600 hover:text-[#159A72]"
                                >
                                  Status
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-xs text-slate-400">
                          No batches found for this criteria.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>

                {/* Pagination */}
                {batchesData && batchesData.total > 15 && (
                  <div className="flex items-center justify-between border-t border-[#d1deda] p-3 text-xs text-slate-500">
                    <span>
                      Showing {batchesData.items.length} of {batchesData.total} batches
                    </span>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => setPage(page - 1)}
                        className="h-7 text-xs"
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page * 15 >= batchesData.total}
                        onClick={() => setPage(page + 1)}
                        className="h-7 text-xs"
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* TAB 2: Movements Table */}
        {activeTab === 'movements' && (
          <Card className="border-[#d1deda]">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Source Type</TableHead>
                    <TableHead className="text-center">Quantity Delta</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isMovementsLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-xs text-slate-400">
                        Loading audit movements...
                      </TableCell>
                    </TableRow>
                  ) : movementsData?.items && movementsData.items.length > 0 ? (
                    movementsData.items.map((m) => {
                      const isPositive = m.type === 'RECEIPT' || m.type === 'SALE_RETURN' || m.type === 'RELEASE';
                      return (
                        <TableRow key={m.id}>
                          <TableCell className="text-xs text-slate-600 font-mono">
                            {formatDate(m.createdAt)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                m.type === 'SALE'
                                  ? 'default'
                                  : m.type === 'RECEIPT'
                                  ? 'secondary'
                                  : m.type === 'WRITE_OFF'
                                  ? 'destructive'
                                  : 'warning'
                              }
                              className="text-[10px]"
                            >
                              {m.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-slate-700">
                            {m.sourceType}
                          </TableCell>
                          <TableCell className="text-center font-bold text-xs">
                            <span className={isPositive ? 'text-emerald-700' : 'text-rose-700'}>
                              {isPositive ? `+${m.quantityUnits}` : `-${m.quantityUnits}`}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-slate-600">
                            {m.actorName || 'System'}
                          </TableCell>
                          <TableCell className="text-xs text-slate-500">
                            {m.reason || '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-xs text-slate-400">
                        No movement audit records found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* TAB 3: Cyclic Counts Table */}
        {activeTab === 'counts' && (
          <Card className="border-[#d1deda]">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Audit Session</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created Date</TableHead>
                    <TableHead className="text-center">Items Counted</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isCountsLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-xs text-slate-400">
                        Loading cyclic counts...
                      </TableCell>
                    </TableRow>
                  ) : countsData?.items && countsData.items.length > 0 ? (
                    countsData.items.map((cnt: any) => (
                      <TableRow key={cnt.id}>
                        <TableCell className="font-semibold text-xs text-[#122A36]">
                          {cnt.name || `Count #${cnt.id.slice(-6)}`}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {cnt.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-slate-500 font-mono">
                          {formatDate(cnt.createdAt)}
                        </TableCell>
                        <TableCell className="text-center font-bold text-xs">
                          {cnt.lines?.length || 0}
                        </TableCell>
                        <TableCell className="text-right">
                          {cnt.status === 'SUBMITTED' && (
                            <Button
                              size="sm"
                              onClick={async () => {
                                await api.inventory.approveCount(cnt.id);
                                toast.success('Count approved and variance adjustments posted');
                                queryClient.invalidateQueries({ queryKey: ['inventory-counts'] });
                              }}
                              className="h-7 text-xs bg-[#159A72] text-white"
                            >
                              Approve
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-xs text-slate-400">
                        No active stock counts in session.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Stock Adjustment Modal */}
        <Dialog open={adjustModalOpen} onOpenChange={setAdjustModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Stock Adjustment / Write-off</DialogTitle>
              <DialogDescription>
                Batch: <span className="font-mono font-bold text-[#122A36]">{selectedBatch?.batchNumber}</span> ({selectedBatch?.product?.brandName}). On-hand: {selectedBatch?.onHandUnits} units.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2 text-xs">
              <div>
                <label className="font-semibold text-slate-700">Action Type</label>
                <select
                  value={adjustType}
                  onChange={(e) => setAdjustType(e.target.value as any)}
                  className="mt-1 w-full rounded-lg border border-[#d1deda] bg-white p-2 text-xs"
                >
                  <option value="WRITE_OFF">Write-off (Damaged or Expired)</option>
                  <option value="ADJUSTMENT">Quantity Adjustment</option>
                </select>
              </div>
              <div>
                <label className="font-semibold text-slate-700">Units to Deduct / Adjust</label>
                <Input
                  type="number"
                  min="1"
                  max={selectedBatch?.onHandUnits || 1}
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(parseInt(e.target.value) || 1)}
                  className="mt-1 text-xs font-bold"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Auditable Reason</label>
                <Input
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g. Expired batch discarded per regulatory disposal"
                  className="mt-1 text-xs"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setAdjustModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => adjustMutation.mutate()}
                disabled={adjustMutation.isPending || !adjustReason.trim() || adjustQty <= 0}
                className="bg-rose-600 text-white hover:bg-rose-700"
              >
                {adjustMutation.isPending ? 'Posting...' : 'Confirm Adjustment'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Batch Status Modal */}
        <Dialog open={statusModalOpen} onOpenChange={setStatusModalOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Update Batch Status</DialogTitle>
              <DialogDescription>
                Batch: <span className="font-mono font-bold">{selectedBatch?.batchNumber}</span>
              </DialogDescription>
            </DialogHeader>

            <div className="py-2 text-xs">
              <label className="font-semibold text-slate-700">Status</label>
              <select
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#d1deda] bg-white p-2 text-xs"
              >
                <option value="ACTIVE">ACTIVE (Available for POS sale)</option>
                <option value="QUARANTINED">QUARANTINED (Hold for inspection)</option>
                <option value="RECALLED">RECALLED (Manufacturer recall)</option>
              </select>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStatusModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => setStatusMutation.mutate()}
                disabled={setStatusMutation.isPending}
                className="bg-[#159A72] text-white hover:bg-[#128361]"
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
