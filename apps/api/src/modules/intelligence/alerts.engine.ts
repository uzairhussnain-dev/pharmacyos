import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { AlertSeverity, AlertType } from '@pharmacy-os/shared-types';
import { Model, Types } from 'mongoose';
import { Alert, AlertDocument, ForecastSnapshot, ForecastSnapshotDocument, StockCount, StockCountDocument } from '../../database/schemas/system.schema';
import { CashSession, CashSessionDocument } from '../../database/schemas/finance.schema';
import { PurchaseOrder, PurchaseOrderDocument } from '../../database/schemas/purchasing.schema';
import { StockMovement, StockMovementDocument } from '../../database/schemas/stock-movement.schema';
import { Batch, BatchDocument } from '../../database/schemas/batch.schema';
import { FORECAST_MODEL_VERSION, RiskService } from '../inventory/risk.service';
import { ReconciliationService } from '../reconciliation/reconciliation.module';
import { SettingsService } from '../settings/settings.module';

const SEVERITY_RANK: Record<AlertSeverity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };

interface AlertDraft {
  type: AlertType;
  severity: AlertSeverity;
  dedupeKey: string;
  title: string;
  explanation: string;
  evidence: Record<string, unknown>;
  estimatedImpactMinor?: number;
  recommendedActions: { code: string; label: string; description: string; href?: string }[];
  entityType?: string;
  entityId?: Types.ObjectId;
}

/**
 * Alerts engine: DETECT → EXPLAIN → RECOMMEND. Runs on a schedule and on demand.
 * Upserts by dedupeKey so a given situation is one alert; auto-resolves alerts whose
 * condition disappeared (outcome recorded as "condition_cleared").
 */
@Injectable()
export class AlertsEngine {
  private readonly logger = new Logger(AlertsEngine.name);
  private running = false;

  constructor(
    @InjectModel(Alert.name) private readonly alerts: Model<AlertDocument>,
    @InjectModel(ForecastSnapshot.name) private readonly forecasts: Model<ForecastSnapshotDocument>,
    @InjectModel(StockCount.name) private readonly counts: Model<StockCountDocument>,
    @InjectModel(CashSession.name) private readonly sessions: Model<CashSessionDocument>,
    @InjectModel(PurchaseOrder.name) private readonly pos: Model<PurchaseOrderDocument>,
    @InjectModel(StockMovement.name) private readonly movements: Model<StockMovementDocument>,
    @InjectModel(Batch.name) private readonly batches: Model<BatchDocument>,
    private readonly risk: RiskService,
    private readonly reconciliation: ReconciliationService,
    private readonly settings: SettingsService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async scheduled() {
    if (process.env.NODE_ENV === 'test') return;
    await this.evaluateAll().catch((e) => this.logger.error(e));
  }

  async evaluateAll(): Promise<{ created: number; updated: number; autoResolved: number }> {
    if (this.running) return { created: 0, updated: 0, autoResolved: 0 };
    this.running = true;
    try {
      const drafts = (
        await Promise.all([this.expiryAlerts(), this.stockoutAlerts(), this.countDiscrepancyAlerts(), this.pendingDeliveryAlerts(), this.unclosedSessionAlerts(), this.reconciliationAlerts(), this.unusualAdjustmentAlerts()])
      ).flat();
      let created = 0;
      let updated = 0;
      const seen = new Set<string>();
      for (const d of drafts) {
        seen.add(d.dedupeKey);
        const existing = await this.alerts.findOne({ dedupeKey: d.dedupeKey }).lean();
        if (!existing) {
          await this.alerts.create({ ...d, severityRank: SEVERITY_RANK[d.severity], status: 'OPEN', lastEvaluatedAt: new Date() });
          created++;
        } else if (existing.status === 'OPEN' || existing.status === 'ACKNOWLEDGED') {
          await this.alerts.updateOne({ _id: existing._id }, { $set: { severity: d.severity, severityRank: SEVERITY_RANK[d.severity], title: d.title, explanation: d.explanation, evidence: d.evidence, estimatedImpactMinor: d.estimatedImpactMinor, recommendedActions: d.recommendedActions, lastEvaluatedAt: new Date() } });
          updated++;
        } else if (existing.status === 'RESOLVED' && existing.resolution && Date.now() - new Date(existing.resolution.resolvedAt).getTime() > 7 * 86400_000) {
          // Condition recurred a week+ after resolution → reopen as fresh signal
          await this.alerts.updateOne({ _id: existing._id }, { $set: { ...d, severityRank: SEVERITY_RANK[d.severity], status: 'OPEN', lastEvaluatedAt: new Date() }, $unset: { resolution: 1 } });
          created++;
        }
      }
      // Auto-resolve alerts whose condition no longer holds
      const stale = await this.alerts.find({ status: { $in: ['OPEN', 'ACKNOWLEDGED'] }, dedupeKey: { $nin: [...seen] } }).lean();
      for (const s of stale) {
        await this.alerts.updateOne({ _id: s._id }, { $set: { status: 'RESOLVED', resolution: { actorId: null, actionCode: 'AUTO_CLEARED', note: 'Condition no longer detected', resolvedAt: new Date(), outcome: { autoCleared: true } } } });
      }
      return { created, updated, autoResolved: stale.length };
    } finally {
      this.running = false;
    }
  }

  private async expiryAlerts(): Promise<AlertDraft[]> {
    const s = await this.settings.get();
    const items = await this.risk.expiryRisk(s.expiryWarningDays);
    return items
      .filter((i) => i.projectedUnsoldUnits > 0 || i.daysToExpiry <= 0)
      .map((i) => {
        const expired = i.daysToExpiry <= 0;
        const actions = [
          ...(expired
            ? [{ code: 'WRITE_OFF', label: 'Write off expired stock', description: `Record a WRITE_OFF of ${i.onHandUnits} ${i.baseUnit} and remove from sellable inventory.`, href: `/dashboard/inventory/batches/${i.batchId}` }]
            : [
                { code: 'PRIORITIZE_FEFO', label: 'Confirm FEFO at counter', description: 'This batch is already first in FEFO order; verify shelf placement matches.', href: `/dashboard/inventory/batches/${i.batchId}` },
                { code: 'PROMOTE', label: 'Review pricing', description: `Consider a time-limited price adjustment on ${i.projectedUnsoldUnits} units likely to be unsold. Only where clinically appropriate.`, href: `/dashboard/products/${i.productId}` },
              ]),
          ...(i.supplierAcceptsReturns && !expired ? [{ code: 'SUPPLIER_RETURN', label: 'Return to supplier', description: 'Supplier accepts near-expiry returns; raise a purchase return before the cut-off.', href: `/dashboard/purchasing?tab=returns&batchId=${i.batchId}` }] : []),
          { code: 'QUARANTINE', label: 'Quarantine', description: 'Move the batch out of sellable stock pending a decision.', href: `/dashboard/inventory/batches/${i.batchId}` },
        ];
        const severity: AlertSeverity = expired ? 'CRITICAL' : i.severity === 'CRITICAL' ? 'CRITICAL' : i.severity === 'HIGH' ? 'HIGH' : i.severity === 'MEDIUM' ? 'MEDIUM' : 'LOW';
        return {
          type: 'EXPIRY_RISK' as const,
          severity,
          dedupeKey: `EXPIRY_RISK:${i.batchId}`,
          title: expired ? `${i.productName} batch ${i.batchNumber} has expired` : `${i.productName} batch ${i.batchNumber} expires in ${i.daysToExpiry} days`,
          explanation: expired
            ? `${i.onHandUnits} ${i.baseUnit} (cost Rs ${(i.costExposureMinor / 100).toFixed(2)}) are past expiry and blocked from sale. They must be written off or returned.`
            : `${i.onHandUnits} ${i.baseUnit} on hand. At the recent average of ${i.avgDailyDemandUnits} ${i.baseUnit}/day${i.demandReliable ? '' : ' (limited history — treat as an estimate)'}, about ${i.projectedSellThroughUnits} will sell before expiry, leaving ~${i.projectedUnsoldUnits} unsold worth Rs ${(i.projectedLossMinor / 100).toFixed(2)} at cost.`,
          evidence: { batchId: i.batchId, productId: i.productId, expiryDate: i.expiryDate, daysToExpiry: i.daysToExpiry, onHandUnits: i.onHandUnits, unitCostMinor: i.unitCostMinor, avgDailyDemandUnits: i.avgDailyDemandUnits, demandReliable: i.demandReliable, projectedSellThroughUnits: i.projectedSellThroughUnits, projectedUnsoldUnits: i.projectedUnsoldUnits, lookbackDays: 30 },
          estimatedImpactMinor: i.projectedLossMinor,
          recommendedActions: actions,
          entityType: 'Batch',
          entityId: new Types.ObjectId(i.batchId),
        };
      });
  }

  private async stockoutAlerts(): Promise<AlertDraft[]> {
    const items = await this.risk.stockoutRisk();
    // Persist forecast snapshots for traceability
    const cutoff = new Date();
    if (items.length) {
      await this.forecasts.insertMany(
        items.map((i) => ({ productId: new Types.ObjectId(i.productId), dataCutoff: cutoff, horizonDays: i.leadTimeDays + 14, avgDailyDemandUnits: i.avgDailyDemandUnits, demandStdDevUnits: i.stdDevDailyUnits, predictedDemandUnits: Math.ceil(i.avgDailyDemandUnits * (i.leadTimeDays + 14)), uncertaintyRange: { low: Math.max(0, Math.floor((i.avgDailyDemandUnits - i.stdDevDailyUnits) * (i.leadTimeDays + 14))), high: Math.ceil((i.avgDailyDemandUnits + i.stdDevDailyUnits) * (i.leadTimeDays + 14)) }, observationDays: i.observationDays, isReliable: i.demandReliable, modelVersion: FORECAST_MODEL_VERSION, eligibleStockUnits: i.eligibleUnits, pendingOrderUnits: i.pendingOrderUnits, daysOfCoverRemaining: i.daysOfCover ?? undefined, projectedStockoutDate: i.projectedStockoutDate ?? undefined, suggestedReorderUnits: i.suggestedReorderUnits })),
        { ordered: false },
      );
    }
    return items.map((i) => {
      const out = i.eligibleUnits <= 0;
      const type: AlertType = out || i.severity === 'HIGH' ? 'STOCKOUT_RISK' : 'LOW_STOCK';
      return {
        type,
        severity: i.severity === 'CRITICAL' ? 'CRITICAL' : i.severity === 'HIGH' ? 'HIGH' : 'MEDIUM',
        dedupeKey: `${type}:${i.productId}`,
        title: out ? `${i.productName} is out of sellable stock` : i.daysOfCover !== null ? `${i.productName} may run out in ~${Math.round(i.daysOfCover)} days` : `${i.productName} is below reorder level`,
        explanation: `${i.eligibleUnits} ${i.baseUnit} sellable${i.pendingOrderUnits ? `, ${i.pendingOrderUnits} on order` : ''}. Demand averages ${i.avgDailyDemandUnits}/day (σ ${i.stdDevDailyUnits}) over ${i.observationDays} days${i.demandReliable ? '' : ' — not enough history for a confident forecast'}. Supplier lead time ${i.leadTimeDays} days → reorder point ${i.reorderPointUnits}.`,
        evidence: { productId: i.productId, eligibleUnits: i.eligibleUnits, pendingOrderUnits: i.pendingOrderUnits, avgDailyDemandUnits: i.avgDailyDemandUnits, stdDevDailyUnits: i.stdDevDailyUnits, leadTimeDays: i.leadTimeDays, daysOfCover: i.daysOfCover, projectedStockoutDate: i.projectedStockoutDate, reorderPointUnits: i.reorderPointUnits, demandReliable: i.demandReliable, modelVersion: FORECAST_MODEL_VERSION },
        recommendedActions: [
          ...(i.suggestedReorderUnits > 0 ? [{ code: 'CREATE_PO', label: `Order ${i.suggestedReorderUnits} ${i.baseUnit}`, description: `Covers lead time + 14 days at current demand with a 90% service-level safety buffer, net of ${i.pendingOrderUnits} already on order.`, href: `/dashboard/purchasing?new=1&productId=${i.productId}&qty=${i.suggestedReorderUnits}` }] : []),
          { code: 'REVIEW_REORDER_LEVEL', label: 'Review reorder level', description: 'Adjust the product reorder level/quantity if demand has structurally changed.', href: `/dashboard/products/${i.productId}` },
        ],
        entityType: 'Product',
        entityId: new Types.ObjectId(i.productId),
      };
    });
  }

  private async countDiscrepancyAlerts(): Promise<AlertDraft[]> {
    const counts = await this.counts.find({ status: 'SUBMITTED' }).lean();
    return counts
      .map((c) => {
        const variances = c.lines.filter((l) => l.countedUnits !== l.systemUnits);
        if (!variances.length) return null;
        const totalAbs = variances.reduce((a, l) => a + Math.abs(l.countedUnits - l.systemUnits), 0);
        return {
          type: 'COUNT_DISCREPANCY' as const,
          severity: (totalAbs > 50 ? 'HIGH' : 'MEDIUM') as AlertSeverity,
          dedupeKey: `COUNT_DISCREPANCY:${c._id}`,
          title: `Stock count ${c.countNumber} has ${variances.length} discrepancies awaiting approval`,
          explanation: `${variances.length} of ${c.lines.length} counted batches differ from the ledger (${totalAbs} units absolute). Approving will post COUNT_ADJUSTMENT movements; rejecting requires a recount.`,
          evidence: { countId: c._id.toString(), countNumber: c.countNumber, variances: variances.slice(0, 20).map((l) => ({ batchNumber: l.batchNumber, productName: l.productName, systemUnits: l.systemUnits, countedUnits: l.countedUnits })) },
          recommendedActions: [{ code: 'REVIEW_COUNT', label: 'Review & approve', description: 'Open the count, verify evidence, then approve or reject.', href: `/dashboard/inventory/counts?id=${c._id}` }],
          entityType: 'StockCount',
          entityId: c._id,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  private async pendingDeliveryAlerts(): Promise<AlertDraft[]> {
    const overdue = await this.pos.find({ status: { $in: ['SUBMITTED', 'PARTIALLY_RECEIVED'] }, expectedDeliveryDate: { $lt: new Date() } }).populate('supplierId', 'name').lean();
    return overdue.map((po) => {
      const days = Math.floor((Date.now() - po.expectedDeliveryDate!.getTime()) / 86400_000);
      return {
        type: 'PENDING_DELIVERY' as const,
        severity: (days > 7 ? 'HIGH' : 'MEDIUM') as AlertSeverity,
        dedupeKey: `PENDING_DELIVERY:${po._id}`,
        title: `${po.poNumber} from ${(po.supplierId as unknown as { name: string }).name} is ${days} day${days === 1 ? '' : 's'} overdue`,
        explanation: `Expected ${po.expectedDeliveryDate!.toDateString()}, status ${po.status}. ${po.lines.reduce((a, l) => a + l.quantityUnits - l.receivedUnits, 0)} units still outstanding.`,
        evidence: { purchaseOrderId: po._id.toString(), poNumber: po.poNumber, expectedDeliveryDate: po.expectedDeliveryDate, status: po.status, outstandingUnits: po.lines.reduce((a, l) => a + l.quantityUnits - l.receivedUnits, 0) },
        recommendedActions: [
          { code: 'CONTACT_SUPPLIER', label: 'Follow up with supplier', description: 'Confirm a revised delivery date and update the PO.', href: `/dashboard/purchasing/${po._id}` },
          { code: 'RECEIVE', label: 'Receive goods', description: 'If the delivery arrived, record the goods receipt.', href: `/dashboard/purchasing/${po._id}?receive=1` },
        ],
        entityType: 'PurchaseOrder',
        entityId: po._id,
      };
    });
  }

  private async unclosedSessionAlerts(): Promise<AlertDraft[]> {
    const old = await this.sessions.find({ status: 'OPEN', openedAt: { $lt: new Date(Date.now() - 14 * 3600_000) } }).populate('cashierId', 'name').lean();
    const closedUnreconciled = await this.sessions.find({ status: 'CLOSED', closedAt: { $lt: new Date(Date.now() - 24 * 3600_000) } }).populate('cashierId', 'name').lean();
    return [
      ...old.map((s) => ({
        type: 'UNCLOSED_SESSION' as const,
        severity: 'MEDIUM' as AlertSeverity,
        dedupeKey: `UNCLOSED_SESSION:${s._id}`,
        title: `${(s.cashierId as unknown as { name: string }).name}'s cash session has been open ${Math.round((Date.now() - s.openedAt.getTime()) / 3600_000)}h`,
        explanation: 'Sessions open longer than a shift make cash reconciliation unreliable. Close it with a counted amount.',
        evidence: { sessionId: s._id.toString(), openedAt: s.openedAt, cashSalesMinor: s.cashSalesMinor },
        recommendedActions: [{ code: 'CLOSE_SESSION', label: 'Close session', description: 'Count the drawer and close.', href: `/dashboard/cash-sessions?id=${s._id}` }],
        entityType: 'CashSession',
        entityId: s._id,
      })),
      ...closedUnreconciled.map((s) => ({
        type: 'UNCLOSED_SESSION' as const,
        severity: (Math.abs(s.varianceMinor ?? 0) > 0 ? 'MEDIUM' : 'LOW') as AlertSeverity,
        dedupeKey: `UNRECONCILED_SESSION:${s._id}`,
        title: `Cash session for ${(s.cashierId as unknown as { name: string }).name} awaits reconciliation`,
        explanation: `Closed with variance Rs ${((s.varianceMinor ?? 0) / 100).toFixed(2)}. A manager must review and mark it reconciled.`,
        evidence: { sessionId: s._id.toString(), closedAt: s.closedAt, expectedClosingMinor: s.expectedClosingMinor, countedClosingMinor: s.countedClosingMinor, varianceMinor: s.varianceMinor },
        recommendedActions: [{ code: 'RECONCILE', label: 'Reconcile', description: 'Review movements and reconcile.', href: `/dashboard/cash-sessions?id=${s._id}` }],
        entityType: 'CashSession',
        entityId: s._id,
      })),
    ];
  }

  private async reconciliationAlerts(): Promise<AlertDraft[]> {
    const result = await this.reconciliation.run();
    return result.discrepancies
      .filter((d) => d.severity !== 'LOW')
      .map((d) => ({
        type: 'RECONCILIATION_ISSUE' as const,
        severity: d.severity as AlertSeverity,
        dedupeKey: `RECON:${d.check}:${d.entityId}`,
        title: `${d.check.replace(/_/g, ' ').toLowerCase()} mismatch on ${d.entityType}`,
        explanation: d.message,
        evidence: { check: d.check, expected: d.expected, actual: d.actual, entityType: d.entityType, entityId: d.entityId },
        recommendedActions: d.repairable
          ? [{ code: 'REPAIR', label: 'Post compensating entry', description: 'Creates an audited REVERSAL movement so ledger equals on-hand. Investigate the root cause first.', href: `/dashboard/settings/audit?entityId=${d.entityId}` }]
          : [{ code: 'INVESTIGATE', label: 'Investigate', description: 'Open the audit trail for this record.', href: `/dashboard/settings/audit?entityId=${d.entityId}` }],
        entityType: d.entityType,
        entityId: Types.ObjectId.isValid(d.entityId) ? new Types.ObjectId(d.entityId) : undefined,
      }));
  }

  /** Stock Detective: unusual manual adjustments (large, repeated, or off-hours) in the last 14 days. */
  private async unusualAdjustmentAlerts(): Promise<AlertDraft[]> {
    const since = new Date(Date.now() - 14 * 86400_000);
    const rows = await this.movements.aggregate<{ _id: { actorId: Types.ObjectId; productId: Types.ObjectId }; count: number; netUnits: number; absUnits: number; valueMinor: number; offHours: number; name: string; product: string }>([
      { $match: { type: { $in: ['ADJUSTMENT', 'COUNT_ADJUSTMENT', 'REVERSAL'] }, createdAt: { $gte: since } } },
      { $addFields: { hour: { $hour: { date: '$createdAt', timezone: 'Asia/Karachi' } } } },
      { $group: { _id: { actorId: '$actorId', productId: '$productId' }, count: { $sum: 1 }, netUnits: { $sum: '$quantityUnits' }, absUnits: { $sum: { $abs: '$quantityUnits' } }, valueMinor: { $sum: { $multiply: [{ $abs: '$quantityUnits' }, '$unitCostMinor'] } }, offHours: { $sum: { $cond: [{ $or: [{ $lt: ['$hour', 8] }, { $gt: ['$hour', 23] }] }, 1, 0] } } } },
      { $lookup: { from: 'users', localField: '_id.actorId', foreignField: '_id', as: 'u' } },
      { $lookup: { from: 'products', localField: '_id.productId', foreignField: '_id', as: 'p' } },
      { $addFields: { name: { $arrayElemAt: ['$u.name', 0] }, product: { $arrayElemAt: ['$p.brandName', 0] } } },
      { $match: { $or: [{ count: { $gte: 3 } }, { valueMinor: { $gte: 500_000 } }, { offHours: { $gte: 1 } }] } },
      { $sort: { valueMinor: -1 } },
      { $limit: 25 },
    ]);
    return rows.map((r) => ({
      type: 'UNUSUAL_ADJUSTMENT' as const,
      severity: (r.valueMinor >= 2_000_000 ? 'HIGH' : 'MEDIUM') as AlertSeverity,
      dedupeKey: `UNUSUAL_ADJUSTMENT:${r._id.actorId}:${r._id.productId}`,
      title: `${r.count} manual adjustment${r.count === 1 ? '' : 's'} on ${r.product} by ${r.name}`,
      explanation: `Net ${r.netUnits > 0 ? '+' : ''}${r.netUnits} units (|${r.absUnits}|, Rs ${(r.valueMinor / 100).toFixed(2)} at cost) in the last 14 days${r.offHours ? `, ${r.offHours} outside 08:00–23:00` : ''}. This is a pattern worth reviewing — it is not an accusation. Common causes: receiving mistakes, unit/pack confusion, or breakage not recorded with reasons.`,
      evidence: { actorId: r._id.actorId.toString(), actorName: r.name, productId: r._id.productId.toString(), productName: r.product, adjustments: r.count, netUnits: r.netUnits, absUnits: r.absUnits, valueMinor: r.valueMinor, offHoursCount: r.offHours, windowDays: 14 },
      recommendedActions: [
        { code: 'REVIEW_MOVEMENTS', label: 'Review movements', description: 'Open the movement ledger filtered to this product.', href: `/dashboard/inventory/movements?productId=${r._id.productId}&type=ADJUSTMENT` },
        { code: 'SCHEDULE_COUNT', label: 'Schedule a stock count', description: 'An independent count by a different staff member settles the question.', href: `/dashboard/inventory/counts?new=1&productId=${r._id.productId}` },
      ],
      entityType: 'Product',
      entityId: r._id.productId,
    }));
  }
}
