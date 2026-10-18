'use client';

import React, { useState } from 'react';
import {
  Users,
  Search,
  Plus,
  CreditCard,
  Phone,
  Receipt,
  Eye,
  CheckCircle,
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
import { formatPKR, formatDate, formatDateTime } from '@/lib/utils';
import { toast } from 'sonner';

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Customer Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [customerForm, setCustomerForm] = useState({
    name: '',
    phone: '',
    address: '',
    creditEnabled: true,
    creditLimitMajor: 5000,
  });

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(1000);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'BANK_TRANSFER' | 'MOBILE_WALLET'>('CASH');
  const [paymentRef, setPaymentRef] = useState('');

  const [ledgerModalOpen, setLedgerModalOpen] = useState(false);
  const [customerDetail, setCustomerDetail] = useState<any>(null);

  // Customers Query
  const { data: customersData, isLoading } = useQuery({
    queryKey: ['customers-list', search, page],
    queryFn: () =>
      api.customers.list({
        search: search || undefined,
        page,
        pageSize: 15,
      }),
  });

  // Create Customer Mutation
  const createCustomerMutation = useMutation({
    mutationFn: async () => {
      return api.customers.create({
        name: customerForm.name,
        phone: customerForm.phone,
        address: customerForm.address || undefined,
        creditEnabled: customerForm.creditEnabled,
        creditLimitMinor: Math.round(customerForm.creditLimitMajor * 100),
      });
    },
    onSuccess: () => {
      toast.success('Customer registered');
      setCreateModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['customers-list'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to register customer');
    },
  });

  // Record Payment Mutation
  const recordPaymentMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCustomer) return;
      return api.customers.recordPayment(selectedCustomer.id, {
        amountMinor: Math.round(paymentAmount * 100),
        paymentMethod,
        reference: paymentRef || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Customer payment recorded in ledger');
      setPaymentModalOpen(false);
      setSelectedCustomer(null);
      queryClient.invalidateQueries({ queryKey: ['customers-list'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to record payment');
    },
  });

  const openLedgerModal = async (c: any) => {
    try {
      const full = await api.customers.getById(c.id);
      setCustomerDetail(full);
      setLedgerModalOpen(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load ledger');
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#122A36]">
              Customers & Credit Accounts
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Track regular patrons, clinic credit balances, and payment receipts.
            </p>
          </div>
          <Button
            onClick={() => setCreateModalOpen(true)}
            className="gap-2 bg-[#159A72] text-white hover:bg-[#128361]"
          >
            <Plus className="h-4 w-4" />
            <span>Add Customer</span>
          </Button>
        </div>

        {/* Filter */}
        <div className="flex items-center justify-between">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search by customer name or phone..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9 text-xs"
            />
          </div>
        </div>

        {/* Customers Table */}
        <Card className="border-[#d1deda]">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Credit Status</TableHead>
                  <TableHead className="text-right">Credit Limit</TableHead>
                  <TableHead className="text-right">Current Balance</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-xs text-slate-400">
                      Loading customer directory...
                    </TableCell>
                  </TableRow>
                ) : customersData?.items && customersData.items.length > 0 ? (
                  customersData.items.map((c) => {
                    const balance = c.balanceMinor || 0;
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-bold text-xs text-[#122A36]">
                          {c.name}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 font-mono">
                          {c.phone}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={c.creditEnabled ? 'success' : 'outline'}
                            className="text-[10px]"
                          >
                            {c.creditEnabled ? 'Credit Approved' : 'Cash Only'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs font-medium">
                          {c.creditEnabled ? formatPKR(c.creditLimitMinor) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-bold text-xs">
                          <span className={balance > 0 ? 'text-rose-700' : 'text-emerald-700'}>
                            {formatPKR(balance)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedCustomer(c);
                                setPaymentAmount(Math.max(1, (c.balanceMinor || 0) / 100));
                                setPaymentModalOpen(true);
                              }}
                              className="h-7 text-xs border-[#d1deda]"
                            >
                              Pay Balance
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openLedgerModal(c)}
                              className="h-7 text-xs text-slate-600 hover:text-[#159A72]"
                            >
                              Ledger
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-xs text-slate-400">
                      No customers found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* MODAL 1: Create Customer */}
        <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Register Customer Account</DialogTitle>
            </DialogHeader>

            <div className="space-y-3 py-2 text-xs">
              <div>
                <label className="font-semibold text-slate-700">Full Name</label>
                <Input
                  value={customerForm.name}
                  onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                  placeholder="e.g. Dr. Naveed Clinic"
                  className="mt-1 text-xs"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Phone</label>
                <Input
                  value={customerForm.phone}
                  onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                  placeholder="0300-1234567"
                  className="mt-1 text-xs font-mono"
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="creditCheck"
                  checked={customerForm.creditEnabled}
                  onChange={(e) => setCustomerForm({ ...customerForm, creditEnabled: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-[#159A72]"
                />
                <label htmlFor="creditCheck" className="font-medium text-slate-700 cursor-pointer">
                  Enable Store Credit
                </label>
              </div>
              {customerForm.creditEnabled && (
                <div>
                  <label className="font-semibold text-slate-700">Credit Limit (PKR)</label>
                  <Input
                    type="number"
                    value={customerForm.creditLimitMajor}
                    onChange={(e) => setCustomerForm({ ...customerForm, creditLimitMajor: parseFloat(e.target.value) || 0 })}
                    className="mt-1 text-xs font-bold"
                  />
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => createCustomerMutation.mutate()}
                disabled={createCustomerMutation.isPending || !customerForm.name || !customerForm.phone}
                className="bg-[#159A72] text-white hover:bg-[#128361]"
              >
                {createCustomerMutation.isPending ? 'Registering...' : 'Save Customer'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* MODAL 2: Record Payment */}
        <Dialog open={paymentModalOpen} onOpenChange={setPaymentModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Record Customer Payment</DialogTitle>
              <DialogDescription>
                Customer: <span className="font-bold text-[#122A36]">{selectedCustomer?.name}</span>. Balance due: {formatPKR(selectedCustomer?.balanceMinor || 0)}.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2 text-xs">
              <div>
                <label className="font-semibold text-slate-700">Amount Received (PKR)</label>
                <Input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(parseFloat(e.target.value) || 0)}
                  className="mt-1 text-base font-bold"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700">Payment Method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as any)}
                  className="mt-1 w-full rounded-lg border border-[#d1deda] bg-white p-2 text-xs font-medium"
                >
                  <option value="CASH">Cash</option>
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="MOBILE_WALLET">Mobile Wallet (Easypaisa/JazzCash)</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700">Reference / Notes</label>
                <Input
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  placeholder="e.g. Bank slip or TxID"
                  className="mt-1 text-xs"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setPaymentModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => recordPaymentMutation.mutate()}
                disabled={recordPaymentMutation.isPending || paymentAmount <= 0}
                className="bg-[#159A72] text-white hover:bg-[#128361]"
              >
                {recordPaymentMutation.isPending ? 'Recording...' : 'Post Payment'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* MODAL 3: Ledger History */}
        <Dialog open={ledgerModalOpen} onOpenChange={setLedgerModalOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Customer Ledger: {customerDetail?.name}</DialogTitle>
              <DialogDescription>
                Current outstanding balance: {formatPKR(customerDetail?.balanceMinor || 0)}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2 text-xs max-h-[300px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customerDetail?.ledger && customerDetail.ledger.length > 0 ? (
                    customerDetail.ledger.map((entry: any, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-slate-600">
                          {formatDate(entry.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {entry.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatPKR(entry.amountMinor)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-[#122A36]">
                          {formatPKR(entry.balanceAfterMinor)}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-6 text-slate-400">
                        No ledger history.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
