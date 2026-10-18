'use client';

import React, { useState } from 'react';
import {
  History,
  Search,
  Filter,
  ShieldCheck,
  Eye,
  Calendar,
  User,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
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
import { formatDate, formatDateTime } from '@/lib/utils';

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [selectedAudit, setSelectedAudit] = useState<any>(null);

  const { data: auditData, isLoading } = useQuery({
    queryKey: ['audit-logs-list', page],
    queryFn: () => api.audit.list({ page, pageSize: 20 }),
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#122A36]">
            Audit Trail & Regulatory Compliance
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Immutable log of all pharmaceutical transactions, inventory adjustments, and cash drawer reconciliations.
          </p>
        </div>

        <Card className="border-[#d1deda]">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Request ID</TableHead>
                  <TableHead className="text-right">Inspection</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-xs text-slate-400">
                      Loading compliance audit trail...
                    </TableCell>
                  </TableRow>
                ) : auditData?.items && auditData.items.length > 0 ? (
                  auditData.items.map((log: any) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs text-slate-600 font-mono">
                        {formatDateTime(log.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-bold">
                          {log.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-700 font-medium">
                        {log.entityType} {log.entityId ? `#${log.entityId.slice(-6)}` : ''}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {log.actorName || log.actorId ? `User #${log.actorId?.slice(-4)}` : 'System'}
                      </TableCell>
                      <TableCell className="text-[10px] font-mono text-slate-400">
                        {log.requestId?.slice(0, 8) || '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedAudit(log)}
                          className="h-7 text-xs text-slate-600 hover:text-[#159A72]"
                        >
                          View Diff
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-xs text-slate-400">
                      No audit logs found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {/* Pagination */}
            {auditData && auditData.total > 20 && (
              <div className="flex items-center justify-between border-t border-[#d1deda] p-3 text-xs text-slate-500">
                <span>
                  Showing {auditData.items.length} of {auditData.total} audit entries
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
                    disabled={page * 20 >= auditData.total}
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

        {/* Audit Details Modal */}
        <Dialog open={!!selectedAudit} onOpenChange={() => setSelectedAudit(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Audit Record Inspection</DialogTitle>
              <DialogDescription>
                Action: <span className="font-mono font-bold">{selectedAudit?.action}</span> on {selectedAudit?.entityType}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2 text-xs">
              <div className="grid grid-cols-2 gap-2 text-slate-600 border-b pb-2">
                <div>Timestamp: <span className="font-mono font-bold text-slate-800">{formatDateTime(selectedAudit?.createdAt)}</span></div>
                <div>Request ID: <span className="font-mono text-slate-800">{selectedAudit?.requestId || '—'}</span></div>
              </div>

              <div>
                <label className="font-semibold text-slate-700">Audit Payload Data</label>
                <pre className="mt-1 max-h-[250px] overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] text-emerald-400">
                  {JSON.stringify(selectedAudit?.payload || selectedAudit?.changes || selectedAudit, null, 2)}
                </pre>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedAudit(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
