'use client';

import React, { useState } from 'react';
import {
  ShieldAlert,
  Sparkles,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Clock,
  ArrowRight,
  Send,
  MessageSquare,
  HelpCircle,
  Info,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/shell/app-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import type { AlertDto } from '@pharmacy-os/shared-types';

export default function IntelligencePage() {
  const queryClient = useQueryClient();
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('OPEN');
  const [page, setPage] = useState(1);

  // Resolve Alert Modal
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<AlertDto | null>(null);
  const [selectedActionCode, setSelectedActionCode] = useState<string>('');
  const [resolveNote, setResolveNote] = useState('');

  // Assistant Chat State
  const [question, setQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState<
    { role: 'user' | 'assistant'; text: string; evidence?: any }[]
  >([
    {
      role: 'assistant',
      text: 'Hello! I am your PharmacyOS Business Assistant. You can ask me questions about today\'s sales, low stock items, top sellers, or expiry risks.',
    },
  ]);

  // Alerts Query
  const { data: alertsData, isLoading: isAlertsLoading } = useQuery({
    queryKey: ['intelligence-alerts', statusFilter, severityFilter, page],
    queryFn: () =>
      api.intelligence.listActions({
        status: statusFilter || undefined,
        severity: severityFilter || undefined,
        page,
        pageSize: 15,
      }),
  });

  // Rebuild Forecast Engine Mutation
  const rebuildMutation = useMutation({
    mutationFn: () => api.intelligence.rebuild(),
    onSuccess: (res) => {
      toast.success(`Intelligence engine refreshed: ${res.scanned} entities scanned, ${res.opened} active alerts.`);
      queryClient.invalidateQueries({ queryKey: ['intelligence-alerts'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to rebuild forecasts');
    },
  });

  // Resolve Alert Mutation
  const resolveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAlert) return;
      return api.intelligence.resolveAction(selectedAlert.id, {
        actionCode: selectedActionCode,
        note: resolveNote || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Alert resolved and resolution logged');
      setResolveModalOpen(false);
      setSelectedAlert(null);
      setResolveNote('');
      queryClient.invalidateQueries({ queryKey: ['intelligence-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['alerts-count'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to resolve alert');
    },
  });

  // Ask Assistant Mutation
  const askMutation = useMutation({
    mutationFn: (q: string) => api.intelligence.ask(q),
    onSuccess: (res) => {
      setChatHistory((prev) => [
        ...prev,
        { role: 'assistant', text: res.answer, evidence: res.evidence },
      ]);
    },
    onError: (err: any) => {
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: `Sorry, I could not process that: ${err.message || 'Service unavailable'}`,
        },
      ]);
    },
  });

  const handleAsk = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || askMutation.isPending) return;

    const q = question.trim();
    setChatHistory((prev) => [...prev, { role: 'user', text: q }]);
    setQuestion('');
    askMutation.mutate(q);
  };

  const openResolveModal = (alert: AlertDto) => {
    setSelectedAlert(alert);
    setSelectedActionCode(alert.recommendedActions?.[0]?.code || 'ACKNOWLEDGE');
    setResolveModalOpen(true);
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#122A36]">
              Action Center & Expiry Rescue
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Explainable inventory insights, stockout risks, and automated expiry mitigation recommendations.
            </p>
          </div>
          <Button
            onClick={() => rebuildMutation.mutate()}
            disabled={rebuildMutation.isPending}
            variant="outline"
            className="gap-2 border-[#d1deda]"
          >
            <RefreshCw className={`h-4 w-4 text-[#159A72] ${rebuildMutation.isPending ? 'animate-spin' : ''}`} />
            <span>Re-evaluate Alert Rules</span>
          </Button>
        </div>

        {/* 2-Column Layout: Alerts Feed on Left, Assistant Q&A on Right */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Main Action Alerts Feed */}
          <div className="space-y-4 lg:col-span-2">
            {/* Filter */}
            <div className="flex items-center gap-3">
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-[#d1deda] bg-white py-1.5 px-3 text-xs font-semibold text-[#122A36]"
              >
                <option value="OPEN">Open Alerts</option>
                <option value="RESOLVED">Resolved Alerts</option>
                <option value="">All Statuses</option>
              </select>

              <select
                value={severityFilter}
                onChange={(e) => {
                  setSeverityFilter(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-[#d1deda] bg-white py-1.5 px-3 text-xs font-semibold text-[#122A36]"
              >
                <option value="">All Severities</option>
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </div>

            {/* Alerts List */}
            <div className="space-y-3">
              {isAlertsLoading ? (
                <Card className="border-[#d1deda] p-8 text-center text-xs text-slate-400">
                  Loading actionable recommendations...
                </Card>
              ) : alertsData?.items && alertsData.items.length > 0 ? (
                alertsData.items.map((alert) => (
                  <Card key={alert.id} className="border-[#d1deda] overflow-hidden hover:shadow-xs transition-shadow">
                    <CardHeader className="bg-[#fbfdfc] pb-3 pt-3 border-b border-slate-100">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={
                              alert.severity === 'CRITICAL' || alert.severity === 'HIGH'
                                ? 'destructive'
                                : alert.severity === 'MEDIUM'
                                ? 'warning'
                                : 'default'
                            }
                            className="text-[10px] font-bold py-0"
                          >
                            {alert.severity}
                          </Badge>
                          <span className="font-bold text-sm text-[#122A36]">{alert.title}</span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400 shrink-0">
                          {formatDate(alert.createdAt)}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 space-y-3">
                      <p className="text-xs text-slate-700 leading-relaxed">
                        {alert.explanation}
                      </p>

                      {/* Evidence & Estimated Impact */}
                      {alert.estimatedImpactMinor ? (
                        <div className="flex items-center gap-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-md px-2.5 py-1.5 w-fit">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          <span>Estimated Expiry Loss at Risk: {formatPKR(alert.estimatedImpactMinor)}</span>
                        </div>
                      ) : null}

                      {/* Recommended Actions */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                        <div className="flex flex-wrap gap-1.5">
                          {alert.recommendedActions?.map((act) => (
                            <span
                              key={act.code}
                              className="rounded bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700"
                            >
                              {act.label}
                            </span>
                          ))}
                        </div>

                        {alert.status === 'OPEN' && (
                          <Button
                            size="sm"
                            onClick={() => openResolveModal(alert)}
                            className="h-8 text-xs bg-[#159A72] text-white hover:bg-[#128361]"
                          >
                            <span>Resolve Action &rarr;</span>
                          </Button>
                        )}
                        {alert.status === 'RESOLVED' && (
                          <Badge variant="success" className="text-[10px]">
                            Resolved
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <Card className="border-[#d1deda] p-12 text-center text-slate-400">
                  <CheckCircle className="h-10 w-10 text-[#159A72] mx-auto mb-2" />
                  <p className="font-bold text-sm text-[#122A36]">No Pending Action Alerts</p>
                  <p className="text-xs text-slate-500 mt-1">
                    All inventory items and batches are within safety guidelines.
                  </p>
                </Card>
              )}
            </div>
          </div>

          {/* Business Assistant Sidebar */}
          <div className="space-y-4">
            <Card className="border-[#d1deda] flex flex-col h-[580px]">
              <CardHeader className="border-b pb-3">
                <CardTitle className="text-sm font-bold text-[#122A36] flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#159A72]" />
                  <span>Pharmacy Business Assistant</span>
                </CardTitle>
                <CardDescription className="text-xs text-slate-500">
                  Answers operational queries using approved backend reporting tools.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
                {chatHistory.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col text-xs ${
                      msg.role === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg p-2.5 leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-[#159A72] text-white font-medium'
                          : 'bg-[#f0f5f3] text-[#122A36] border border-[#dce8e4]'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}
              </CardContent>

              {/* Chat Input */}
              <form onSubmit={handleAsk} className="border-t p-3 flex gap-2">
                <Input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask e.g. What are today's sales?"
                  className="text-xs"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={askMutation.isPending || !question.trim()}
                  className="bg-[#159A72] text-white hover:bg-[#128361] shrink-0"
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </form>
            </Card>
          </div>
        </div>

        {/* Resolve Alert Modal */}
        <Dialog open={resolveModalOpen} onOpenChange={setResolveModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Resolve Action Alert</DialogTitle>
              <DialogDescription>
                Confirm operational action taken on: <span className="font-semibold text-[#122A36]">{selectedAlert?.title}</span>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 text-xs">
              <div>
                <label className="font-semibold text-slate-700">Action Taken</label>
                <select
                  value={selectedActionCode}
                  onChange={(e) => setSelectedActionCode(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[#d1deda] bg-white p-2 text-xs font-medium"
                >
                  {selectedAlert?.recommendedActions?.map((act) => (
                    <option key={act.code} value={act.code}>
                      {act.label} — {act.description}
                    </option>
                  ))}
                  <option value="MANUAL_RESOLUTION">Other Verified Action</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700">Resolution Note</label>
                <Input
                  value={resolveNote}
                  onChange={(e) => setResolveNote(e.target.value)}
                  placeholder="e.g. Discounted batch at counter or initiated stock transfer"
                  className="mt-1 text-xs"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setResolveModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => resolveMutation.mutate()}
                disabled={resolveMutation.isPending}
                className="bg-[#159A72] text-white hover:bg-[#128361]"
              >
                {resolveMutation.isPending ? 'Resolving...' : 'Confirm Resolution'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
