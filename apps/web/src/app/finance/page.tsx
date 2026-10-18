'use client';

import React, { useState } from 'react';
import {
  Building2,
  Plus,
  Receipt,
  ArrowUpRight,
  ArrowDownLeft,
  Calendar,
  CheckCircle,
  CircleDollarSign,
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
import { useAuth } from '@/lib/auth-context';
import { formatPKR, formatDate } from '@/lib/utils';
import { toast } from 'sonner';

export default function FinancePage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<'expenses' | 'receivables' | 'payables'>('expenses');
  const [page, setPage] = useState(1);

  // Create Expense Modal
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    category: 'UTILITIES',
    amountMajor: 5000,
    date: new Date().toISOString().slice(0, 10),
    paymentMethod: 'CASH',
    description: '',
  });

  // Queries
  const { data: receivables } = useQuery({
    queryKey: ['finance-receivables'],
    queryFn: () => api.finance.receivables(),
  });

  const { data: payables } = useQuery({
    queryKey: ['finance-payables'],
    queryFn: () => api.finance.payables(),
  });

  const { data: expensesData, isLoading: isExpensesLoading } = useQuery({
    queryKey: ['expenses-list', page],
    queryFn: () => api.expenses.list({ page, pageSize: 15 }),
    enabled: activeTab === 'expenses',
  });

  // Create Expense Mutation
  const createExpenseMutation = useMutation({
    mutationFn: async () => {
      return api.expenses.create({
        category: expenseForm.category,
        amountMinor: Math.round(expenseForm.amountMajor * 100),
        date: new Date(expenseForm.date).toISOString(),
        paymentMethod: expenseForm.paymentMethod,
        description: expenseForm.description,
      });
    },
    onSuccess: () => {
      toast.success('Operating expense registered');
      setExpenseModalOpen(false);
      setExpenseForm({ ...expenseForm, description: '', amountMajor: 5000 });
      queryClient.invalidateQueries({ queryKey: ['expenses-list'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to record expense');
    },
  });

  // Approve Expense Mutation
  const approveExpenseMutation = useMutation({
    mutationFn: async (id: string) => {
      return api.expenses.approve(id);
    },
    onSuccess: () => {
      toast.success('Expense approved');
      queryClient.invalidateQueries({ queryKey: ['expenses-list'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to approve expense');
    },
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#122A36]">
              Financial Operations & Operating Expenses
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Accounts receivable, distributor payables, and verified pharmacy overhead expenses.
            </p>
          </div>
          <Button
            onClick={() => setExpenseModalOpen(true)}
            className="gap-2 bg-[#159A72] text-white hover:bg-[#128361]"
          >
            <Plus className="h-4 w-4" />
            <span>Add Operating Expense</span>
          </Button>
        </div>

        {/* Financial KPI Summary Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card className="border-[#d1deda]">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-slate-500">
                Accounts Receivable (Customer Credit)
              </CardTitle>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-[#159A72]">
                <ArrowDownLeft className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[#159A72]">
                {formatPKR(receivables?.totalReceivableMinor ?? 0)}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Outstanding balance across {receivables?.customers?.length || 0} customer accounts
              </p>
            </CardContent>
          </Card>

          <Card className="border-[#d1deda]">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-slate-500">
                Accounts Payable (Supplier Credit)
              </CardTitle>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                <ArrowUpRight className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-rose-700">
                {formatPKR(payables?.totalPayableMinor ?? 0)}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Due to {payables?.suppliers?.length || 0} pharmaceutical suppliers
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#d1deda] gap-6 text-sm font-semibold">
          <button
            onClick={() => setActiveTab('expenses')}
            className={`pb-3 transition-colors ${
              activeTab === 'expenses'
                ? 'border-b-2 border-[#159A72] text-[#159A72]'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Operating Expenses
          </button>
          <button
            onClick={() => setActiveTab('receivables')}
            className={`pb-3 transition-colors ${
              activeTab === 'receivables'
                ? 'border-b-2 border-[#159A72] text-[#159A72]'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Receivables Ledger
          </button>
          <button
            onClick={() => setActiveTab('payables')}
            className={`pb-3 transition-colors ${
              activeTab === 'payables'
                ? 'border-b-2 border-[#159A72] text-[#159A72]'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Payables to Suppliers
          </button>
        </div>

        {/* TAB 1: Operating Expenses */}
        {activeTab === 'expenses' && (
          <Card className="border-[#d1deda]">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Payment Method</TableHead>
                    <TableHead className="text-right">Amount (PKR)</TableHead>
                    <TableHead>Recorded By</TableHead>
                    <TableHead>Approval</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isExpensesLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-xs text-slate-400">
                        Loading operating expenses...
                      </TableCell>
                    </TableRow>
                  ) : expensesData?.items && expensesData.items.length > 0 ? (
                    expensesData.items.map((exp: any) => (
                      <TableRow key={exp.id}>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] font-bold">
                            {exp.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 font-mono">
                          {formatDate(exp.date)}
                        </TableCell>
                        <TableCell className="text-xs text-slate-800">
                          {exp.description}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {exp.paymentMethod}
                        </TableCell>
                        <TableCell className="text-right font-bold text-xs text-[#122A36]">
                          {formatPKR(exp.amountMinor)}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {exp.createdByName || 'Owner'}
                        </TableCell>
                        <TableCell>
                          {exp.approvedAt ? (
                            <Badge variant="success" className="text-[10px]">
                              Approved
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => approveExpenseMutation.mutate(exp.id)}
                              className="h-6 text-[10px] bg-[#159A72] text-white"
                            >
                              Approve
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-xs text-slate-400">
                        No expenses recorded.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* TAB 2: Receivables List */}
        {activeTab === 'receivables' && (
          <Card className="border-[#d1deda]">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer / Clinic</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead className="text-right">Credit Limit</TableHead>
                    <TableHead className="text-right">Balance Due (PKR)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receivables?.customers && receivables.customers.length > 0 ? (
                    receivables.customers.map((c: any) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-bold text-xs text-[#122A36]">
                          {c.name}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 font-mono">
                          {c.phone}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {formatPKR(c.creditLimitMinor)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-xs text-rose-700">
                          {formatPKR(c.balanceMinor)}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-xs text-slate-400">
                        No outstanding customer credit balances.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* TAB 3: Payables List */}
        {activeTab === 'payables' && (
          <Card className="border-[#d1deda]">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier / Distributor</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead className="text-right">Amount Payable (PKR)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payables?.suppliers && payables.suppliers.length > 0 ? (
                    payables.suppliers.map((s: any) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-bold text-xs text-[#122A36]">
                          {s.name}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 font-mono">
                          {s.phone}
                        </TableCell>
                        <TableCell className="text-right font-bold text-xs text-rose-700">
                          {formatPKR(s.balanceMinor)}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={3} className="py-8 text-center text-xs text-slate-400">
                        No outstanding supplier payables.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Create Expense Modal */}
        <Dialog open={expenseModalOpen} onOpenChange={setExpenseModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Record Operating Expense</DialogTitle>
              <DialogDescription>
                Record operational overhead (rent, salaries, electricity, consumables).
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2 text-xs">
              <div>
                <label className="font-semibold text-slate-700">Category</label>
                <select
                  value={expenseForm.category}
                  onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-[#d1deda] bg-white p-2 text-xs font-medium"
                >
                  {['RENT', 'UTILITIES', 'SALARIES', 'SUPPLIES', 'MAINTENANCE', 'MARKETING', 'TRANSPORT', 'OTHER'].map(
                    (cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    )
                  )}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700">Amount (PKR)</label>
                <Input
                  type="number"
                  value={expenseForm.amountMajor}
                  onChange={(e) => setExpenseForm({ ...expenseForm, amountMajor: parseFloat(e.target.value) || 0 })}
                  className="mt-1 text-sm font-bold"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700">Payment Method</label>
                <select
                  value={expenseForm.paymentMethod}
                  onChange={(e) => setExpenseForm({ ...expenseForm, paymentMethod: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-[#d1deda] bg-white p-2 text-xs font-medium"
                >
                  <option value="CASH">Cash Drawer</option>
                  <option value="BANK_TRANSFER">Bank Transfer / Cheque</option>
                  <option value="MOBILE_WALLET">Mobile Wallet</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700">Description</label>
                <Input
                  value={expenseForm.description}
                  onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
                  placeholder="e.g. LESCO electricity bill for current month"
                  className="mt-1 text-xs"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setExpenseModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => createExpenseMutation.mutate()}
                disabled={createExpenseMutation.isPending || !expenseForm.description || expenseForm.amountMajor <= 0}
                className="bg-[#159A72] text-white hover:bg-[#128361]"
              >
                {createExpenseMutation.isPending ? 'Saving...' : 'Record Expense'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
