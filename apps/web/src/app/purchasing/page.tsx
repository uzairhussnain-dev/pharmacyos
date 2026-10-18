'use client';

import React, { useState } from 'react';
import {
  Truck,
  Plus,
  PackageCheck,
  Receipt,
  Building,
  CheckCircle,
  Clock,
  ArrowRight,
  Filter,
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
import type { PurchaseOrderDto } from '@pharmacy-os/shared-types';

export default function PurchasingPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'orders' | 'receipts' | 'suppliers'>('orders');
  const [page, setPage] = useState<number>(1);

  // Modals
  const [createPoOpen, setCreatePoOpen] = useState(false);
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [createSupplierOpen, setCreateSupplierOpen] = useState(false);
  const [selectedPo, setSelectedPo] = useState<PurchaseOrderDto | null>(null);

  // New PO State
  const [poSupplierId, setPoSupplierId] = useState('');
  const [poLines, setPoLines] = useState<{ productId: string; quantityUnits: number; unitCostMajor: number }[]>([
    { productId: '', quantityUnits: 100, unitCostMajor: 15 },
  ]);

  // Receive Stock state
  const [receiveLines, setReceiveLines] = useState<
    { productId: string; batchNumber: string; expiryDate: string; quantityUnits: number; unitCostMajor: number }[]
  >([]);
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');

  // New Supplier State
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    phone: '',
    contactName: '',
    email: '',
    address: '',
    paymentTermsDays: 30,
  });

  // Queries
  const { data: ordersData, isLoading: isOrdersLoading } = useQuery({
    queryKey: ['purchasing-orders', page],
    queryFn: () => api.purchasing.listOrders({ page, pageSize: 15 }),
    enabled: activeTab === 'orders',
  });

  const { data: receiptsData, isLoading: isReceiptsLoading } = useQuery({
    queryKey: ['goods-receipts', page],
    queryFn: () => api.purchasing.listReceipts({ page, pageSize: 15 }),
    enabled: activeTab === 'receipts',
  });

  const { data: suppliersData, isLoading: isSuppliersLoading } = useQuery({
    queryKey: ['suppliers-list', page],
    queryFn: () => api.suppliers.list({ page, pageSize: 20 }),
  });

  const { data: productsData } = useQuery({
    queryKey: ['products-for-po'],
    queryFn: () => api.products.list({ pageSize: 100 }),
  });

  // Create PO Mutation
  const createPoMutation = useMutation({
    mutationFn: async () => {
      return api.purchasing.createOrder({
        supplierId: poSupplierId,
        lines: poLines.map((l) => ({
          productId: l.productId,
          quantityUnits: Number(l.quantityUnits),
          unitCostMinor: Math.round(l.unitCostMajor * 100),
        })),
        expectedDeliveryDate: new Date(Date.now() + 5 * 86400_000).toISOString(),
      });
    },
    onSuccess: (po) => {
      toast.success(`Purchase order ${po.poNumber} created as Draft`);
      setCreatePoOpen(false);
      queryClient.invalidateQueries({ queryKey: ['purchasing-orders'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to create purchase order');
    },
  });

  // Submit PO Mutation
  const submitPoMutation = useMutation({
    mutationFn: async (id: string) => {
      return api.purchasing.submitOrder(id);
    },
    onSuccess: () => {
      toast.success('Purchase order submitted to supplier');
      queryClient.invalidateQueries({ queryKey: ['purchasing-orders'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to submit PO');
    },
  });

  // Receive PO Stock Mutation
  const receiveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPo) return;
      return api.purchasing.receiveOrder(selectedPo.id, {
        lines: receiveLines.map((l) => ({
          productId: l.productId,
          batchNumber: l.batchNumber,
          expiryDate: l.expiryDate,
          quantityUnits: Number(l.quantityUnits),
          unitCostMinor: Math.round(l.unitCostMajor * 100),
        })),
        supplierInvoiceNumber: supplierInvoiceNo || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Stock received into inventory batches successfully');
      setReceiveModalOpen(false);
      setSelectedPo(null);
      queryClient.invalidateQueries({ queryKey: ['purchasing-orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-batches'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to receive stock');
    },
  });

  // Create Supplier Mutation
  const createSupplierMutation = useMutation({
    mutationFn: async () => {
      return api.suppliers.create(supplierForm);
    },
    onSuccess: () => {
      toast.success('Supplier registered');
      setCreateSupplierOpen(false);
      queryClient.invalidateQueries({ queryKey: ['suppliers-list'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to register supplier');
    },
  });

  const openReceiveModal = (po: PurchaseOrderDto) => {
    setSelectedPo(po);
    setSupplierInvoiceNo(`INV-${Math.floor(1000 + Math.random() * 9000)}`);
    setReceiveLines(
      po.lines.map((line, idx) => ({
        productId: line.productId,
        batchNumber: `LOT-${Date.now().toString().slice(-4)}-${idx + 1}`,
        expiryDate: new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10),
        quantityUnits: line.quantityUnits - line.receivedUnits,
        unitCostMajor: line.unitCostMinor / 100,
      }))
    );
    setReceiveModalOpen(true);
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#122A36]">
              Purchasing & Supply Chain
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Manage pharmaceutical suppliers, track purchase orders, and receive batches into inventory.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setPoSupplierId(suppliersData?.items?.[0]?.id || '');
                setCreatePoOpen(true);
              }}
              className="gap-2 bg-[#159A72] text-white hover:bg-[#128361]"
            >
              <Plus className="h-4 w-4" />
              <span>Create Purchase Order</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => setCreateSupplierOpen(true)}
              className="gap-2 border-[#d1deda]"
            >
              <Building className="h-4 w-4 text-slate-600" />
              <span>Add Supplier</span>
            </Button>
          </div>
        </div>

        {/* Tab Controls */}
        <div className="flex border-b border-[#d1deda] gap-6 text-sm font-semibold">
          <button
            onClick={() => setActiveTab('orders')}
            className={`pb-3 transition-colors ${
              activeTab === 'orders'
                ? 'border-b-2 border-[#159A72] text-[#159A72]'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Purchase Orders
          </button>
          <button
            onClick={() => setActiveTab('receipts')}
            className={`pb-3 transition-colors ${
              activeTab === 'receipts'
                ? 'border-b-2 border-[#159A72] text-[#159A72]'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Goods Receipts (GRNs)
          </button>
          <button
            onClick={() => setActiveTab('suppliers')}
            className={`pb-3 transition-colors ${
              activeTab === 'suppliers'
                ? 'border-b-2 border-[#159A72] text-[#159A72]'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Supplier Directory
          </button>
        </div>

        {/* TAB 1: Purchase Orders */}
        {activeTab === 'orders' && (
          <Card className="border-[#d1deda]">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PO Number</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Items / Units</TableHead>
                    <TableHead className="text-right">Total (PKR)</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expected Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isOrdersLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-xs text-slate-400">
                        Loading purchase orders...
                      </TableCell>
                    </TableRow>
                  ) : ordersData?.items && ordersData.items.length > 0 ? (
                    ordersData.items.map((po) => (
                      <TableRow key={po.id}>
                        <TableCell className="font-mono font-bold text-xs text-[#122A36]">
                          {po.poNumber}
                        </TableCell>
                        <TableCell className="font-semibold text-xs text-slate-800">
                          {po.supplierName || 'Supplier'}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {po.lines?.length || 0} items ({po.lines?.reduce((sum, l) => sum + l.quantityUnits, 0)} units)
                        </TableCell>
                        <TableCell className="text-right font-bold text-xs text-[#122A36]">
                          {formatPKR(po.totalMinor)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              po.status === 'RECEIVED'
                                ? 'success'
                                : po.status === 'SUBMITTED'
                                ? 'warning'
                                : 'secondary'
                            }
                            className="text-[10px]"
                          >
                            {po.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {formatDate(po.expectedDeliveryDate)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {po.status === 'DRAFT' && (
                              <Button
                                size="sm"
                                onClick={() => submitPoMutation.mutate(po.id)}
                                className="h-7 text-xs bg-[#122A36] text-white"
                              >
                                Submit PO
                              </Button>
                            )}
                            {(po.status === 'SUBMITTED' || po.status === 'PARTIALLY_RECEIVED') && (
                              <Button
                                size="sm"
                                onClick={() => openReceiveModal(po)}
                                className="h-7 text-xs bg-[#159A72] text-white hover:bg-[#128361] gap-1"
                              >
                                <PackageCheck className="h-3.5 w-3.5" />
                                <span>Receive Stock</span>
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-xs text-slate-400">
                        No purchase orders found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* TAB 2: Goods Receipts */}
        {activeTab === 'receipts' && (
          <Card className="border-[#d1deda]">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>GRN Number</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Supplier Invoice</TableHead>
                    <TableHead>Date Received</TableHead>
                    <TableHead className="text-center">Batches Created</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isReceiptsLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-xs text-slate-400">
                        Loading goods receipts...
                      </TableCell>
                    </TableRow>
                  ) : receiptsData?.items && receiptsData.items.length > 0 ? (
                    receiptsData.items.map((grn: any) => (
                      <TableRow key={grn.id}>
                        <TableCell className="font-mono font-bold text-xs text-[#122A36]">
                          {grn.grnNumber || `GRN-${grn.id.slice(-6)}`}
                        </TableCell>
                        <TableCell className="font-semibold text-xs text-slate-800">
                          {grn.supplierName || 'Distributor'}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 font-mono">
                          {grn.supplierInvoiceNumber || '—'}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500 font-mono">
                          {formatDate(grn.createdAt)}
                        </TableCell>
                        <TableCell className="text-center font-bold text-xs">
                          {grn.lines?.length || 0}
                        </TableCell>
                        <TableCell className="text-right font-bold text-xs text-[#159A72]">
                          {formatPKR(grn.totalCostMinor || 0)}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-xs text-slate-400">
                        No goods receipts found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* TAB 3: Suppliers Directory */}
        {activeTab === 'suppliers' && (
          <Card className="border-[#d1deda]">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier / Distributor</TableHead>
                    <TableHead>Contact Person</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Terms</TableHead>
                    <TableHead className="text-right">Outstanding Payable</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isSuppliersLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-xs text-slate-400">
                        Loading suppliers...
                      </TableCell>
                    </TableRow>
                  ) : suppliersData?.items && suppliersData.items.length > 0 ? (
                    suppliersData.items.map((s: any) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-bold text-xs text-[#122A36]">
                          {s.name}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {s.contactName || '—'}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-slate-700">
                          {s.phone}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          Net {s.paymentTermsDays || 30} days
                        </TableCell>
                        <TableCell className="text-right font-bold text-xs text-rose-700">
                          {formatPKR(s.payableBalanceMinor || 0)}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-xs text-slate-400">
                        No suppliers registered.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* MODAL 1: Create Purchase Order */}
        <Dialog open={createPoOpen} onOpenChange={setCreatePoOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Purchase Order</DialogTitle>
              <DialogDescription>
                Select supplier and specify product lines with agreed unit costs.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 text-xs">
              <div>
                <label className="font-semibold text-slate-700">Supplier</label>
                <select
                  value={poSupplierId}
                  onChange={(e) => setPoSupplierId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[#d1deda] bg-white p-2 text-xs font-medium"
                >
                  {suppliersData?.items?.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.phone})
                    </option>
                  ))}
                </select>
              </div>

              {/* Line items */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-700">Order Lines</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setPoLines([
                        ...poLines,
                        { productId: productsData?.items?.[0]?.id || '', quantityUnits: 50, unitCostMajor: 10 },
                      ])
                    }
                    className="h-7 text-xs border-[#d1deda]"
                  >
                    + Add Product Line
                  </Button>
                </div>

                {poLines.map((line, idx) => (
                  <div key={idx} className="flex gap-2 items-center border border-slate-200 rounded-lg p-2 bg-slate-50">
                    <select
                      value={line.productId}
                      onChange={(e) => {
                        const next = [...poLines];
                        next[idx].productId = e.target.value;
                        setPoLines(next);
                      }}
                      className="flex-1 rounded border border-[#d1deda] bg-white p-1.5 text-xs font-medium"
                    >
                      <option value="">Select Medicine</option>
                      {productsData?.items?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.brandName} ({p.sku})
                        </option>
                      ))}
                    </select>

                    <div className="w-24">
                      <Input
                        type="number"
                        min="1"
                        placeholder="Quantity"
                        value={line.quantityUnits}
                        onChange={(e) => {
                          const next = [...poLines];
                          next[idx].quantityUnits = parseInt(e.target.value) || 1;
                          setPoLines(next);
                        }}
                        className="text-xs h-8"
                      />
                    </div>

                    <div className="w-28">
                      <Input
                        type="number"
                        step="0.1"
                        placeholder="Unit Cost (PKR)"
                        value={line.unitCostMajor}
                        onChange={(e) => {
                          const next = [...poLines];
                          next[idx].unitCostMajor = parseFloat(e.target.value) || 0;
                          setPoLines(next);
                        }}
                        className="text-xs h-8 font-bold"
                      />
                    </div>

                    {poLines.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPoLines(poLines.filter((_, i) => i !== idx))}
                        className="h-8 w-8 p-0 text-rose-600"
                      >
                        ×
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setCreatePoOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => createPoMutation.mutate()}
                disabled={createPoMutation.isPending || !poSupplierId || poLines.some((l) => !l.productId)}
                className="bg-[#159A72] text-white hover:bg-[#128361]"
              >
                {createPoMutation.isPending ? 'Saving...' : 'Save Draft PO'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* MODAL 2: Receive Stock against PO */}
        <Dialog open={receiveModalOpen} onOpenChange={setReceiveModalOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Goods Receipt against {selectedPo?.poNumber}</DialogTitle>
              <DialogDescription>
                Assign physical manufacturer batch/lot number and expiration date for every received unit.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 text-xs">
              <div>
                <label className="font-semibold text-slate-700">Supplier Invoice / Delivery Slip #</label>
                <Input
                  value={supplierInvoiceNo}
                  onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                  placeholder="e.g. SI-98765"
                  className="mt-1 text-xs"
                />
              </div>

              <div className="space-y-3">
                <span className="font-semibold text-slate-700">Physical Batches to Register</span>
                {receiveLines.map((line, idx) => {
                  const product = productsData?.items?.find((p) => p.id === line.productId);
                  return (
                    <div key={idx} className="border border-slate-200 rounded-lg p-3 bg-slate-50 space-y-2">
                      <div className="font-bold text-[#122A36]">
                        {product?.brandName || 'Product'} (SKU: {product?.sku})
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[11px] text-slate-500">Lot / Batch #</label>
                          <Input
                            value={line.batchNumber}
                            onChange={(e) => {
                              const next = [...receiveLines];
                              next[idx].batchNumber = e.target.value;
                              setReceiveLines(next);
                            }}
                            className="mt-0.5 text-xs h-8 font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-slate-500">Expiry Date</label>
                          <Input
                            type="date"
                            value={line.expiryDate}
                            onChange={(e) => {
                              const next = [...receiveLines];
                              next[idx].expiryDate = e.target.value;
                              setReceiveLines(next);
                            }}
                            className="mt-0.5 text-xs h-8"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-slate-500">Units Received</label>
                          <Input
                            type="number"
                            min="1"
                            value={line.quantityUnits}
                            onChange={(e) => {
                              const next = [...receiveLines];
                              next[idx].quantityUnits = parseInt(e.target.value) || 1;
                              setReceiveLines(next);
                            }}
                            className="mt-0.5 text-xs h-8 font-bold"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setReceiveModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => receiveMutation.mutate()}
                disabled={receiveMutation.isPending || receiveLines.some((l) => !l.batchNumber || !l.expiryDate)}
                className="bg-[#159A72] text-white hover:bg-[#128361]"
              >
                {receiveMutation.isPending ? 'Receiving...' : 'Confirm Stock Receipt (GRN)'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* MODAL 3: Add Supplier */}
        <Dialog open={createSupplierOpen} onOpenChange={setCreateSupplierOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Register Pharmaceutical Supplier</DialogTitle>
              <DialogDescription>
                Add authorized distributor or pharmaceutical vendor.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2 text-xs">
              <div>
                <label className="font-semibold text-slate-700">Distributor Company Name</label>
                <Input
                  value={supplierForm.name}
                  onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
                  placeholder="e.g. GSK Pakistan Distribution"
                  className="mt-1 text-xs"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Contact Person</label>
                <Input
                  value={supplierForm.contactName}
                  onChange={(e) => setSupplierForm({ ...supplierForm, contactName: e.target.value })}
                  placeholder="e.g. Tariq Mehmood"
                  className="mt-1 text-xs"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Phone</label>
                <Input
                  value={supplierForm.phone}
                  onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                  placeholder="0300-1234567"
                  className="mt-1 text-xs font-mono"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Credit Terms (Days)</label>
                <Input
                  type="number"
                  value={supplierForm.paymentTermsDays}
                  onChange={(e) => setSupplierForm({ ...supplierForm, paymentTermsDays: parseInt(e.target.value) || 30 })}
                  className="mt-1 text-xs"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateSupplierOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => createSupplierMutation.mutate()}
                disabled={createSupplierMutation.isPending || !supplierForm.name || !supplierForm.phone}
                className="bg-[#159A72] text-white hover:bg-[#128361]"
              >
                {createSupplierMutation.isPending ? 'Registering...' : 'Register Supplier'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
