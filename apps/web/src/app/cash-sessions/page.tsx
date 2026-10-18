'use client';

import React, { useState } from 'react';
import {
  CircleDollarSign,
  Plus,
  Minus,
  CheckCircle,
  AlertTriangle,
  Lock,
  Unlock,
  Receipt,
  FileCheck,
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
import type { CashSessionDto } from '@pharmacy-os/shared-types';

export default function CashSessionsPage() {
  const queryClient = useQueryClient();
  const { user, hasPermission } = useAuth();
  const [page, setPage] = useState(1);

  // Modals
  const [openModalOpen, setOpenModalOpen] = useState(false);
  const [openingFloat, setOpeningFloat] = useState<number>(5000);

  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<CashSessionDto | null>(null);
  const [countedClosing, setCountedClosing] = useState<number>(0);
  const [closingNotes, setClosingNotes] = useState('');

  const [movementModalOpen, setMovementModalOpen] = useState(false);
  const [movementType, setMovementType] = useState<'CASH_IN' | 'CASH_OUT'>('CASH_OUT');
  const [movementAmount, setMovementAmount] = useState<number>(500);
  const [movementReason, setMovementReason] = useState('');

  // Fetch Cash Sessions
  const { data: sessionsData, isLoading } = useQuery({
    queryKey: ['cash-sessions-list', page],
    queryFn: () => api.cashSessions.list({ page, pageSize: 15 }),
  });

  // Fetch Current Session
  const { data: currentSession } = useQuery({
    queryKey: ['cash-session-current', user?.id],
    queryFn: () => api.cashSessions.current(),
    enabled: !!user,
  });

  // Open Drawer Mutation
  const openMutation = useMutation({
    mutationFn: async () => {
      return api.cashSessions.open({ openingFloatMinor: Math.round(openingFloat * 100) });
    },
    onSuccess: () => {
      toast.success('Cash drawer session opened');
      setOpenModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['cash-sessions-list'] });
      queryClient.invalidateQueries({ queryKey: ['cash-session-current'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to open session');
    },
  });

  // Close Drawer Mutation
  const closeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSession) return;
      return api.cashSessions.close(selectedSession.id, {
        countedClosingMinor: Math.round(countedClosing * 100),
        notes: closingNotes || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Cash drawer session closed and physical count recorded');
      setCloseModalOpen(false);
      setSelectedSession(null);
      queryClient.invalidateQueries({ queryKey: ['cash-sessions-list'] });
      queryClient.invalidateQueries({ queryKey: ['cash-session-current'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to close session');
    },
  });

  // Cash Movement Mutation
  const movementMutation = useMutation({
    mutationFn: async () => {
      if (!currentSession) return;
      return api.cashSessions.addMovement(currentSession.id, {
        type: movementType,
        amountMinor: Math.round(movementAmount * 100),
        reason: movementReason,
      });
    },
    onSuccess: () => {
      toast.success(`${movementType} recorded in drawer`);
      setMovementModalOpen(false);
      setMovementReason('');
      queryClient.invalidateQueries({ queryKey: ['cash-sessions-list'] });
      queryClient.invalidateQueries({ queryKey: ['cash-session-current'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to record movement');
    },
  });

  // Reconcile Session Mutation
  const reconcileMutation = useMutation({
    mutationFn: async (id: string) => {
      return api.cashSessions.reconcile(id, { notes: 'Reconciled by manager' });
    },
    onSuccess: () => {
      toast.success('Session verified and marked reconciled');
      queryClient.invalidateQueries({ queryKey: ['cash-sessions-list'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to reconcile session');
    },
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#122A36]">
              Cash Drawer Sessions
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Shift-level cash drawer reconciliation, cash-in/out tracking, and discrepancy auditing.
            </p>
          </div>
          <div className="flex gap-2">
            {!currentSession ? (
              <Button
                onClick={() => setOpenModalOpen(true)}
                className="gap-2 bg-[#159A72] text-white hover:bg-[#128361]"
              >
                <Unlock className="h-4 w-4" />
                <span>Open Drawer Session</span>
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => setMovementModalOpen(true)}
                  className="gap-2 border-[#d1deda]"
                >
                  <CircleDollarSign className="h-4 w-4 text-slate-600" />
                  <span>Cash In / Cash Out</span>
                </Button>
                <Button
                  onClick={() => {
                    setSelectedSession(currentSession);
                    setCountedClosing(currentSession.expectedClosingMinor / 100);
                    setCloseModalOpen(true);
                  }}
                  className="gap-2 bg-[#122A36] text-white hover:bg-[#1b3a4a]"
                >
                  <Lock className="h-4 w-4" />
                  <span>Count & Close Shift</span>
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Current Active Session Card */}
        {currentSession && (
          <Card className="border-emerald-200 bg-emerald-50/40">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold text-emerald-950 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Active Shift: {currentSession.cashierName || user?.name}
                </CardTitle>
                <Badge variant="success" className="text-[10px]">
                  DRAWER OPEN
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-xs">
                <div>
                  <span className="text-slate-500">Opening Float:</span>
                  <div className="font-bold text-[#122A36] text-sm mt-0.5">
                    {formatPKR(currentSession.openingFloatMinor)}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Cash Sales:</span>
                  <div className="font-bold text-emerald-700 text-sm mt-0.5">
                    +{formatPKR(currentSession.cashSalesMinor)}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Cash In / Out:</span>
                  <div className="font-bold text-slate-700 text-sm mt-0.5">
                    +{formatPKR(currentSession.cashInMinor)} / -{formatPKR(currentSession.cashOutMinor)}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500 font-semibold">Expected in Drawer:</span>
                  <div className="font-extrabold text-[#159A72] text-base mt-0.5">
                    {formatPKR(currentSession.expectedClosingMinor)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sessions History Table */}
        <Card className="border-[#d1deda]">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cashier</TableHead>
                  <TableHead>Opened At</TableHead>
                  <TableHead>Opening Float</TableHead>
                  <TableHead>Cash Sales</TableHead>
                  <TableHead>Expected Closing</TableHead>
                  <TableHead>Counted Closing</TableHead>
                  <TableHead>Variance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-xs text-slate-400">
                      Loading cash sessions...
                    </TableCell>
                  </TableRow>
                ) : sessionsData?.items && sessionsData.items.length > 0 ? (
                  sessionsData.items.map((sess) => {
                    const variance = sess.varianceMinor ?? 0;
                    const hasDiscrepancy = variance !== 0;

                    return (
                      <TableRow key={sess.id}>
                        <TableCell className="font-bold text-xs text-[#122A36]">
                          {sess.cashierName || 'Cashier'}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 font-mono">
                          {formatDateTime(sess.openedAt)}
                        </TableCell>
                        <TableCell className="text-xs text-slate-700 font-medium">
                          {formatPKR(sess.openingFloatMinor)}
                        </TableCell>
                        <TableCell className="text-xs font-semibold text-emerald-700">
                          {formatPKR(sess.cashSalesMinor)}
                        </TableCell>
                        <TableCell className="text-xs font-bold text-[#122A36]">
                          {formatPKR(sess.expectedClosingMinor)}
                        </TableCell>
                        <TableCell className="text-xs font-mono font-medium">
                          {sess.countedClosingMinor !== undefined
                            ? formatPKR(sess.countedClosingMinor)
                            : '—'}
                        </TableCell>
                        <TableCell>
                          {sess.countedClosingMinor !== undefined ? (
                            <span
                              className={`text-xs font-bold ${
                                variance === 0
                                  ? 'text-emerald-700'
                                  : variance > 0
                                  ? 'text-blue-700'
                                  : 'text-rose-700'
                              }`}
                            >
                              {variance === 0
                                ? 'Balanced'
                                : variance > 0
                                ? `+${formatPKR(variance)}`
                                : formatPKR(variance)}
                            </span>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              sess.status === 'RECONCILED'
                                ? 'success'
                                : sess.status === 'OPEN'
                                ? 'warning'
                                : 'secondary'
                            }
                            className="text-[10px]"
                          >
                            {sess.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {sess.status === 'CLOSED' && hasPermission('cash.reconcile') && (
                            <Button
                              size="sm"
                              onClick={() => reconcileMutation.mutate(sess.id)}
                              className="h-7 text-xs bg-[#159A72] text-white hover:bg-[#128361]"
                            >
                              Reconcile
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-xs text-slate-400">
                      No drawer sessions found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* MODAL 1: Open Drawer */}
        <Dialog open={openModalOpen} onOpenChange={setOpenModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Open Cash Drawer Shift</DialogTitle>
              <DialogDescription>
                Confirm initial physical cash float counted in the drawer.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 text-xs">
              <div>
                <label className="font-semibold text-slate-700">Opening Float (PKR)</label>
                <Input
                  type="number"
                  value={openingFloat}
                  onChange={(e) => setOpeningFloat(parseFloat(e.target.value) || 0)}
                  className="mt-1 text-sm font-bold"
                />
              </div>
              <div className="flex gap-2">
                {[2000, 5000, 10000].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setOpeningFloat(amt)}
                    className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Rs. {amt.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => openMutation.mutate()}
                disabled={openMutation.isPending || openingFloat < 0}
                className="bg-[#159A72] text-white hover:bg-[#128361]"
              >
                {openMutation.isPending ? 'Opening...' : 'Confirm Open Shift'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* MODAL 2: Close Drawer & Count Physical Cash */}
        <Dialog open={closeModalOpen} onOpenChange={setCloseModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Close Shift & Physical Count</DialogTitle>
              <DialogDescription>
                Count all banknotes and coins in drawer and enter total PKR.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 text-xs">
              <div className="rounded-lg bg-slate-50 border p-3 space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Expected Closing:</span>
                  <span className="font-bold text-[#122A36]">
                    {formatPKR(selectedSession?.expectedClosingMinor)}
                  </span>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700">Physical Cash Counted (PKR)</label>
                <Input
                  type="number"
                  value={countedClosing}
                  onChange={(e) => setCountedClosing(parseFloat(e.target.value) || 0)}
                  className="mt-1 text-base font-bold"
                  autoFocus
                />
              </div>

              {/* Real-time Variance Preview */}
              <div className="flex items-center justify-between border-t pt-2">
                <span className="font-semibold text-slate-600">Calculated Variance:</span>
                <span
                  className={`font-extrabold text-sm ${
                    Math.round(countedClosing * 100) - (selectedSession?.expectedClosingMinor || 0) === 0
                      ? 'text-emerald-700'
                      : 'text-rose-700'
                  }`}
                >
                  {formatPKR(Math.round(countedClosing * 100) - (selectedSession?.expectedClosingMinor || 0))}
                </span>
              </div>

              <div>
                <label className="font-semibold text-slate-700">Notes (Optional)</label>
                <Input
                  value={closingNotes}
                  onChange={(e) => setClosingNotes(e.target.value)}
                  placeholder="e.g. End of shift balance verified"
                  className="mt-1 text-xs"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setCloseModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => closeMutation.mutate()}
                disabled={closeMutation.isPending || countedClosing < 0}
                className="bg-[#122A36] text-white hover:bg-[#1b3a4a]"
              >
                {closeMutation.isPending ? 'Closing...' : 'Confirm & Close Drawer'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* MODAL 3: Cash In / Cash Out */}
        <Dialog open={movementModalOpen} onOpenChange={setMovementModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Drawer Cash In / Cash Out</DialogTitle>
              <DialogDescription>
                Record intermediate cash drop, petty cash expense, or float addition.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 text-xs">
              <div>
                <label className="font-semibold text-slate-700">Movement Direction</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setMovementType('CASH_OUT')}
                    className={`rounded-lg border p-2 font-bold ${
                      movementType === 'CASH_OUT'
                        ? 'border-rose-500 bg-rose-50 text-rose-700'
                        : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    Cash Out (Expense / Drop)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMovementType('CASH_IN')}
                    className={`rounded-lg border p-2 font-bold ${
                      movementType === 'CASH_IN'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    Cash In (Float Add)
                  </button>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700">Amount (PKR)</label>
                <Input
                  type="number"
                  value={movementAmount}
                  onChange={(e) => setMovementAmount(parseFloat(e.target.value) || 0)}
                  className="mt-1 text-sm font-bold"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700">Auditable Reason</label>
                <Input
                  value={movementReason}
                  onChange={(e) => setMovementReason(e.target.value)}
                  placeholder="e.g. Petty cash for packaging materials"
                  className="mt-1 text-xs"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setMovementModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => movementMutation.mutate()}
                disabled={movementMutation.isPending || !movementReason.trim() || movementAmount <= 0}
                className="bg-[#159A72] text-white hover:bg-[#128361]"
              >
                {movementMutation.isPending ? 'Posting...' : 'Record Movement'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
