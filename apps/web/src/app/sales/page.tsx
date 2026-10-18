'use client';

import React, { useState } from 'react';
import {
  Receipt,
  Search,
  Filter,
  Eye,
  Printer,
  RotateCcw,
  CheckCircle,
  XCircle,
  Calendar,
  User,
  CreditCard,
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
import { useAuth } from '@/lib/auth-context';
import { formatPKR, formatDate, formatDateTime } from '@/lib/utils';
import { toast } from 'sonner';
import type { SaleDto } from '@pharmacy-os/shared-types';

export default function SalesPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<'sales' | 'returns'>('sales');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Detail Modal State
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedSale, setSelectedSale] = useState<SaleDto | null>(null);

  // Return Creation Modal State
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnSale, setReturnSale] = useState<SaleDto | null>(null);
  const [returnLineIndex, setReturnLineIndex] = useState(0);
  const [returnQty, setReturnQty] = useState(1);
  const [returnDisposition, setReturnDisposition] = useState<'RESTOCK' | 'QUARANTINE' | 'WRITE_OFF'>('RESTOCK');
  const [returnReason, setReturnReason] = useState('');

  // Receipt Modal State
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [receiptData, setReceiptData] = useState<any>(null);

  // Sales List Query
  const { data: salesData, isLoading: isSalesLoading } = useQuery({
    queryKey: ['sales-list', search, page],
    queryFn: () =>
      api.sales.list({
        search: search || undefined,
        page,
        pageSize: 15,
      }),
    enabled: activeTab === 'sales',
  });

  // Returns List Query
  const { data: returnsData, isLoading: isReturnsLoading } = useQuery({
    queryKey: ['sales-returns-list', page],
    queryFn: () =>
      api.sales.listReturns({
        page,
        pageSize: 15,
      }),
    enabled: activeTab === 'returns',
  });

  // Create Return Mutation
  const createReturnMutation = useMutation({
    mutationFn: async () => {
      if (!returnSale) return;
      return api.sales.createReturn(returnSale.id, {
        lines: [
          {
            lineIndex: returnLineIndex,
            quantityUnits: returnQty,
            disposition: returnDisposition,
          },
        ],
        reason: returnReason || 'Customer returned item with receipt',
        refundMethod: 'CASH',
      });
    },
    onSuccess: () => {
      toast.success('Sale return submitted for pharmacist approval');
      setReturnModalOpen(false);
      setReturnSale(null);
      queryClient.invalidateQueries({ queryKey: ['sales-list'] });
      queryClient.invalidateQueries({ queryKey: ['sales-returns-list'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to submit return');
    },
  });

  // Approve Return Mutation
  const approveReturnMutation = useMutation({
    mutationFn: async ({ saleId, returnId }: { saleId: string; returnId: string }) => {
      return api.sales.approveReturn(saleId, returnId);
    },
    onSuccess: () => {
      toast.success('Return approved and stock disposition applied');
      queryClient.invalidateQueries({ queryKey: ['sales-returns-list'] });
      queryClient.invalidateQueries({ queryKey: ['sales-list'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-batches'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to approve return');
    },
  });

  const openReceiptModal = async (saleId: string) => {
    try {
      const data = await api.sales.receipt(saleId);
      setReceiptData(data);
      setReceiptModalOpen(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load receipt');
    }
  };

  const printReceipt = () => {
    window.print();
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#122A36]">
            Sales Ledger & Return Processing
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Every customer transaction with FEFO lot allocations, payment tenders, and verified returns.
          </p>
        </div>

        {/* Tab Controls */}
        <div className="flex border-b border-[#d1deda] gap-6 text-sm font-semibold">
          <button
            onClick={() => {
              setActiveTab('sales');
              setPage(1);
            }}
            className={`pb-3 transition-colors ${
              activeTab === 'sales'
                ? 'border-b-2 border-[#159A72] text-[#159A72]'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Sales Transactions
          </button>
          <button
            onClick={() => {
              setActiveTab('returns');
              setPage(1);
            }}
            className={`pb-3 transition-colors ${
              activeTab === 'returns'
                ? 'border-b-2 border-[#159A72] text-[#159A72]'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Returns & Approvals
          </button>
        </div>

        {/* TAB 1: Sales Transactions */}
        {activeTab === 'sales' && (
          <div className="space-y-4">
            {/* Filter */}
            <div className="flex items-center justify-between">
              <div className="relative max-w-sm flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search invoice number or customer..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="pl-9 text-xs"
                />
              </div>
            </div>

            <Card className="border-[#d1deda]">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Date & Time</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Cashier</TableHead>
                      <TableHead className="text-center">Items</TableHead>
                      <TableHead className="text-right">Total (PKR)</TableHead>
                      <TableHead>Tender</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isSalesLoading ? (
                      <TableRow>
                        <TableCell colSpan={9} className="py-8 text-center text-xs text-slate-400">
                          Loading sales transactions...
                        </TableCell>
                      </TableRow>
                    ) : salesData?.items && salesData.items.length > 0 ? (
                      salesData.items.map((sale) => (
                        <TableRow key={sale.id}>
                          <TableCell className="font-mono font-bold text-xs text-[#122A36]">
                            {sale.invoiceNumber}
                          </TableCell>
                          <TableCell className="text-xs text-slate-600 font-mono">
                            {formatDateTime(sale.createdAt)}
                          </TableCell>
                          <TableCell className="text-xs text-slate-800 font-medium">
                            {sale.customerName || 'Walk-in Customer'}
                          </TableCell>
                          <TableCell className="text-xs text-slate-600">
                            {sale.cashierName || 'Cashier'}
                          </TableCell>
                          <TableCell className="text-center font-bold text-xs">
                            {sale.lines.length}
                          </TableCell>
                          <TableCell className="text-right font-bold text-xs text-[#159A72]">
                            {formatPKR(sale.totalMinor)}
                          </TableCell>
                          <TableCell>
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                              {sale.payments?.[0]?.method || 'CASH'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                sale.status === 'COMPLETED'
                                  ? 'success'
                                  : sale.status === 'PARTIALLY_RETURNED'
                                  ? 'warning'
                                  : 'destructive'
                              }
                              className="text-[10px]"
                            >
                              {sale.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openReceiptModal(sale.id)}
                                className="h-7 text-xs border-[#d1deda] gap-1"
                                title="Print thermal receipt"
                              >
                                <Printer className="h-3.5 w-3.5 text-slate-600" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSelectedSale(sale);
                                  setDetailModalOpen(true);
                                }}
                                className="h-7 text-xs border-[#d1deda]"
                              >
                                View
                              </Button>
                              {hasPermission('sales.return') && sale.status === 'COMPLETED' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setReturnSale(sale);
                                    setReturnLineIndex(0);
                                    setReturnQty(1);
                                    setReturnReason('Customer returned unopened medicine');
                                    setReturnModalOpen(true);
                                  }}
                                  className="h-7 text-xs text-slate-600 hover:text-amber-700"
                                  title="Initiate return"
                                >
                                  Return
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={9} className="py-8 text-center text-xs text-slate-400">
                          No sales transactions found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>

                {/* Pagination */}
                {salesData && salesData.total > 15 && (
                  <div className="flex items-center justify-between border-t border-[#d1deda] p-3 text-xs text-slate-500">
                    <span>
                      Showing {salesData.items.length} of {salesData.total} transactions
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
                        disabled={page * 15 >= salesData.total}
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

        {/* TAB 2: Returns & Approvals */}
        {activeTab === 'returns' && (
          <Card className="border-[#d1deda]">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Refund Amount</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isReturnsLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-xs text-slate-400">
                        Loading return records...
                      </TableCell>
                    </TableRow>
                  ) : returnsData?.items && returnsData.items.length > 0 ? (
                    returnsData.items.map((ret: any) => (
                      <TableRow key={ret.id}>
                        <TableCell className="font-mono font-bold text-xs text-[#122A36]">
                          {ret.invoiceNumber || ret.saleId?.invoiceNumber || `Sale #${ret.saleId}`}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 font-mono">
                          {formatDateTime(ret.createdAt)}
                        </TableCell>
                        <TableCell className="font-bold text-xs text-rose-700">
                          {formatPKR(ret.refundMinor)}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 max-w-xs truncate">
                          {ret.reason}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              ret.status === 'APPROVED'
                                ? 'success'
                                : ret.status === 'PENDING_APPROVAL'
                                ? 'warning'
                                : 'destructive'
                            }
                            className="text-[10px]"
                          >
                            {ret.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {ret.status === 'PENDING_APPROVAL' && hasPermission('sales.return.approve') && (
                            <Button
                              size="sm"
                              onClick={() =>
                                approveReturnMutation.mutate({
                                  saleId: ret.saleId?._id || ret.saleId,
                                  returnId: ret.id,
                                })
                              }
                              className="h-7 text-xs bg-[#159A72] text-white hover:bg-[#128361]"
                            >
                              Approve Return
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-xs text-slate-400">
                        No return records found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* MODAL 1: Sale Detail View */}
        <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Sale Details: {selectedSale?.invoiceNumber}</DialogTitle>
              <DialogDescription>
                Confirmed at {formatDateTime(selectedSale?.createdAt)} by {selectedSale?.cashierName || 'Cashier'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 text-xs">
              {/* Lines */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Medicine</TableHead>
                      <TableHead className="text-center">Qty</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Line Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedSale?.lines?.map((line, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          <div className="font-bold text-[#122A36]">{line.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            Allocated Batch:{' '}
                            {line.allocations?.map((a) => `${a.batchNumber} (${a.quantityUnits}u)`).join(', ') || 'Auto FEFO'}
                          </div>
                        </TableCell>
                        <TableCell className="text-center font-bold">
                          {line.quantity} {line.unitName || 'Units'}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatPKR(line.unitPriceMinor)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-[#159A72]">
                          {formatPKR(line.lineTotalMinor)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Totals */}
              <div className="space-y-1 text-right text-xs">
                <div>Subtotal: <span className="font-semibold">{formatPKR(selectedSale?.subtotalMinor)}</span></div>
                {selectedSale?.discountMinor ? (
                  <div className="text-emerald-700">Discount: <span className="font-semibold">-{formatPKR(selectedSale.discountMinor)}</span></div>
                ) : null}
                <div className="text-sm font-bold text-[#122A36] pt-1 border-t">
                  Grand Total: <span className="text-[#159A72] font-extrabold text-base">{formatPKR(selectedSale?.totalMinor)}</span>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDetailModalOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* MODAL 2: Create Sale Return */}
        <Dialog open={returnModalOpen} onOpenChange={setReturnModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Initiate Sale Return</DialogTitle>
              <DialogDescription>
                Invoice: <span className="font-mono font-bold">{returnSale?.invoiceNumber}</span>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2 text-xs">
              <div>
                <label className="font-semibold text-slate-700">Select Returned Item</label>
                <select
                  value={returnLineIndex}
                  onChange={(e) => setReturnLineIndex(parseInt(e.target.value) || 0)}
                  className="mt-1 w-full rounded-lg border border-[#d1deda] bg-white p-2 text-xs font-medium"
                >
                  {returnSale?.lines?.map((line, idx) => (
                    <option key={idx} value={idx}>
                      {line.name} ({line.quantity} purchased) — {formatPKR(line.lineTotalMinor)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700">Quantity to Return</label>
                <Input
                  type="number"
                  min="1"
                  max={returnSale?.lines[returnLineIndex]?.quantityUnits || 1}
                  value={returnQty}
                  onChange={(e) => setReturnQty(parseInt(e.target.value) || 1)}
                  className="mt-1 text-xs font-bold"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700">Stock Inspection Disposition</label>
                <select
                  value={returnDisposition}
                  onChange={(e) => setReturnDisposition(e.target.value as any)}
                  className="mt-1 w-full rounded-lg border border-[#d1deda] bg-white p-2 text-xs font-medium"
                >
                  <option value="RESTOCK">Restock (Unopened & intact packaging)</option>
                  <option value="QUARANTINE">Quarantine (Inspect batch integrity)</option>
                  <option value="WRITE_OFF">Write-off (Damaged or opened medicine)</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700">Return Reason</label>
                <Input
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  placeholder="e.g. Doctor adjusted dosage"
                  className="mt-1 text-xs"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setReturnModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => createReturnMutation.mutate()}
                disabled={createReturnMutation.isPending || returnQty <= 0}
                className="bg-[#159A72] text-white hover:bg-[#128361]"
              >
                {createReturnMutation.isPending ? 'Submitting...' : 'Submit Return'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* MODAL 3: Receipt Reprint Modal */}
        <Dialog open={receiptModalOpen} onOpenChange={setReceiptModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Thermal Receipt Reprint</DialogTitle>
              <DialogDescription>
                Authorized invoice reprint.
              </DialogDescription>
            </DialogHeader>

            <div className="border border-slate-200 bg-white p-4 rounded-lg">
              <div id="printable-receipt" className="font-mono text-xs text-black leading-tight space-y-2">
                <div className="text-center pb-2 border-b border-dashed border-black">
                  <div className="font-bold text-sm uppercase">
                    {receiptData?.pharmacy?.name || 'Shifa Pharmacy'}
                  </div>
                  <div className="text-[10px]">{receiptData?.pharmacy?.address}</div>
                  <div className="text-[10px]">Phone: {receiptData?.pharmacy?.phone}</div>
                </div>

                <div className="text-[10px] space-y-0.5 pb-2 border-b border-dashed border-black">
                  <div className="flex justify-between">
                    <span>Invoice:</span>
                    <span className="font-bold">{receiptData?.sale?.invoiceNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Date:</span>
                    <span>{formatDateTime(receiptData?.sale?.createdAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cashier:</span>
                    <span>{receiptData?.sale?.cashierName}</span>
                  </div>
                </div>

                <div className="space-y-1 pb-2 border-b border-dashed border-black">
                  {receiptData?.sale?.lines?.map((line: any, idx: number) => (
                    <div key={idx} className="flex justify-between text-[10px]">
                      <span>{line.name} ({line.quantity}x)</span>
                      <span className="font-bold">{formatPKR(line.lineTotalMinor)}</span>
                    </div>
                  ))}
                </div>

                <div className="space-y-0.5 pt-1">
                  <div className="flex justify-between font-bold text-xs">
                    <span>TOTAL:</span>
                    <span>{formatPKR(receiptData?.sale?.totalMinor)}</span>
                  </div>
                </div>

                <div className="text-center text-[9px] pt-2 text-slate-700">
                  <p>*** REPRINT COPY ***</p>
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setReceiptModalOpen(false)}>
                Done
              </Button>
              <Button onClick={printReceipt} className="bg-[#159A72] text-white hover:bg-[#128361] gap-1.5">
                <Printer className="h-4 w-4" />
                <span>Print Receipt</span>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
