import { Body, Controller, Get, Injectable, Module, Post } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsString, MaxLength, MinLength } from 'class-validator';
import { Model, Types } from 'mongoose';
import { AuthUser, CurrentUser, RequestId, RequirePermissions } from '../../common/decorators';
import { DomainError, ErrorCodes, NotFoundError } from '../../common/errors';
import { TransactionService } from '../../database/database.module';
import { Batch, BatchDocument } from '../../database/schemas/batch.schema';
import { CashSession, CashSessionDocument } from '../../database/schemas/finance.schema';
import { IdempotencyRecord, IdempotencyRecordDocument } from '../../database/schemas/idempotency.schema';
import { Payment, PaymentDocument, Sale, SaleDocument } from '../../database/schemas/sales.schema';
import { StockMovement, StockMovementDocument } from '../../database/schemas/stock-movement.schema';
import { AuditService } from '../audit/audit.module';
import { expectedClosing } from '../cash-sessions/cash-sessions.module';
import { InventoryModule } from '../inventory/inventory.module';
import { StockLedgerService } from '../inventory/stock-ledger.service';

export interface Discrepancy {
  check: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  entityType: string;
  entityId: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
  repairable: boolean;
}

export class RepairDto {
  @IsIn(['BATCH_BALANCE']) check: 'BATCH_BALANCE';
  @IsMongoId() entityId: string;
  @IsString() @MinLength(10) @MaxLength(300) reason: string;
}

/**
 * Integrity checks across the ledger and financial records. Read-only; repairs are explicit,
 * authorised, audited, and implemented as compensating ledger entries — never as edits.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    @InjectModel(Batch.name) private readonly batches: Model<BatchDocument>,
    @InjectModel(StockMovement.name) private readonly movements: Model<StockMovementDocument>,
    @InjectModel(Sale.name) private readonly sales: Model<SaleDocument>,
    @InjectModel(Payment.name) private readonly payments: Model<PaymentDocument>,
    @InjectModel(CashSession.name) private readonly sessions: Model<CashSessionDocument>,
    @InjectModel(IdempotencyRecord.name) private readonly idem: Model<IdempotencyRecordDocument>,
    private readonly ledger: StockLedgerService,
    private readonly tx: TransactionService,
    private readonly audit: AuditService,
  ) {}

  async run(): Promise<{ ranAt: Date; checks: Record<string, number>; discrepancies: Discrepancy[] }> {
    const results = await Promise.all([
      this.batchBalanceVsLedger(),
      this.salesVsMovements(),
      this.saleTotalsVsPayments(),
      this.refundsVsPayments(),
      this.cashSessionsVsMovements(),
      this.idempotencyVsSales(),
    ]);
    const discrepancies = results.flat();
    const checks: Record<string, number> = {};
    for (const d of discrepancies) checks[d.check] = (checks[d.check] ?? 0) + 1;
    return { ranAt: new Date(), checks, discrepancies };
  }

  /** Σ movements per batch must equal batch.onHandUnits. */
  async batchBalanceVsLedger(): Promise<Discrepancy[]> {
    const sums = await this.movements.aggregate<{ _id: Types.ObjectId; total: number }>([{ $group: { _id: '$batchId', total: { $sum: '$quantityUnits' } } }]);
    const sumMap = new Map(sums.map((s) => [s._id.toString(), s.total]));
    const batches = await this.batches.find({}, { onHandUnits: 1, batchNumber: 1 }).lean();
    const out: Discrepancy[] = [];
    for (const b of batches) {
      const ledger = sumMap.get(b._id.toString()) ?? 0;
      if (ledger !== b.onHandUnits) {
        out.push({ check: 'BATCH_BALANCE', severity: 'HIGH', entityType: 'Batch', entityId: b._id.toString(), message: `Batch ${b.batchNumber}: ledger sum ${ledger} ≠ on-hand ${b.onHandUnits}`, expected: ledger, actual: b.onHandUnits, repairable: true });
      }
    }
    return out;
  }

  /** Every completed sale must have SALE movements matching its allocations. */
  async salesVsMovements(): Promise<Discrepancy[]> {
    const since = new Date(Date.now() - 90 * 86400_000);
    const sales = await this.sales.find({ createdAt: { $gte: since } }, { lines: 1, invoiceNumber: 1 }).lean();
    const moves = await this.movements.aggregate<{ _id: Types.ObjectId; total: number }>([{ $match: { sourceType: 'Sale', type: 'SALE', createdAt: { $gte: since } } }, { $group: { _id: '$sourceId', total: { $sum: '$quantityUnits' } } }]);
    const moveMap = new Map(moves.map((m) => [m._id.toString(), m.total]));
    const out: Discrepancy[] = [];
    for (const s of sales) {
      const expected = -s.lines.reduce((a, l) => a + l.allocations.reduce((x, al) => x + al.quantityUnits, 0), 0);
      const actual = moveMap.get(s._id.toString()) ?? 0;
      if (expected !== actual) out.push({ check: 'SALE_MOVEMENTS', severity: 'HIGH', entityType: 'Sale', entityId: s._id.toString(), message: `${s.invoiceNumber}: allocations ${-expected} units but ledger shows ${-actual}`, expected, actual, repairable: false });
    }
    return out;
  }

  /** Σ positive payments must equal sale.paidMinor. */
  async saleTotalsVsPayments(): Promise<Discrepancy[]> {
    const since = new Date(Date.now() - 90 * 86400_000);
    const rows = await this.payments.aggregate<{ _id: Types.ObjectId; paid: number }>([{ $match: { amountMinor: { $gt: 0 }, createdAt: { $gte: since } } }, { $group: { _id: '$saleId', paid: { $sum: '$amountMinor' } } }]);
    const payMap = new Map(rows.map((r) => [r._id.toString(), r.paid]));
    const sales = await this.sales.find({ createdAt: { $gte: since } }, { paidMinor: 1, invoiceNumber: 1 }).lean();
    const out: Discrepancy[] = [];
    for (const s of sales) {
      const paid = payMap.get(s._id.toString()) ?? 0;
      if (paid !== s.paidMinor) out.push({ check: 'SALE_PAYMENTS', severity: 'HIGH', entityType: 'Sale', entityId: s._id.toString(), message: `${s.invoiceNumber}: payments ${paid} ≠ paid ${s.paidMinor}`, expected: s.paidMinor, actual: paid, repairable: false });
    }
    return out;
  }

  /** Refunds (negative payments) must never exceed the original payment. */
  async refundsVsPayments(): Promise<Discrepancy[]> {
    const rows = await this.payments.aggregate<{ _id: Types.ObjectId; refunded: number; original: number }>([
      { $match: { amountMinor: { $lt: 0 }, refundOfPaymentId: { $ne: null } } },
      { $group: { _id: '$refundOfPaymentId', refunded: { $sum: '$amountMinor' } } },
      { $lookup: { from: 'payments', localField: '_id', foreignField: '_id', as: 'orig' } },
      { $unwind: '$orig' },
      { $project: { refunded: 1, original: '$orig.amountMinor' } },
    ]);
    return rows
      .filter((r) => -r.refunded > r.original)
      .map((r) => ({ check: 'REFUND_LIMIT', severity: 'HIGH' as const, entityType: 'Payment', entityId: r._id.toString(), message: `Refunds ${-r.refunded} exceed original payment ${r.original}`, expected: r.original, actual: -r.refunded, repairable: false }));
  }

  /** Session running totals must equal the sum of its movements. */
  async cashSessionsVsMovements(): Promise<Discrepancy[]> {
    const sessions = await this.sessions.find({ openedAt: { $gte: new Date(Date.now() - 90 * 86400_000) } }).lean();
    const out: Discrepancy[] = [];
    for (const s of sessions) {
      const fromMovements = s.movements.reduce((a, m) => a + m.amountMinor, 0);
      const fromTotals = expectedClosing(s) - s.openingFloatMinor;
      if (fromMovements !== fromTotals) out.push({ check: 'CASH_SESSION', severity: 'MEDIUM', entityType: 'CashSession', entityId: s._id.toString(), message: `Session totals ${fromTotals} ≠ movements ${fromMovements}`, expected: fromMovements, actual: fromTotals, repairable: false });
      if (s.status !== 'OPEN' && s.varianceMinor !== undefined && Math.abs(s.varianceMinor) > 0) {
        out.push({ check: 'CASH_VARIANCE', severity: Math.abs(s.varianceMinor) > 50_000 ? 'HIGH' : 'LOW', entityType: 'CashSession', entityId: s._id.toString(), message: `Closed with variance ${s.varianceMinor}`, actual: s.varianceMinor, repairable: false });
      }
    }
    return out;
  }

  /** Every COMPLETED idempotency record must point to an existing sale and vice-versa. */
  async idempotencyVsSales(): Promise<Discrepancy[]> {
    const out: Discrepancy[] = [];
    const completed = await this.idem.find({ status: 'COMPLETED' }, { saleId: 1, key: 1 }).lean();
    const saleIds = completed.map((c) => c.saleId).filter(Boolean) as Types.ObjectId[];
    const existing = new Set((await this.sales.find({ _id: { $in: saleIds } }, { _id: 1 }).lean()).map((s) => s._id.toString()));
    for (const c of completed) {
      if (!c.saleId || !existing.has(c.saleId.toString())) out.push({ check: 'IDEMPOTENCY', severity: 'MEDIUM', entityType: 'IdempotencyRecord', entityId: c._id.toString(), message: `Record ${c.key} marked completed but sale missing`, repairable: false });
    }
    const stale = await this.idem.find({ status: 'PENDING', createdAt: { $lte: new Date(Date.now() - 10 * 60_000) } }).lean();
    for (const s of stale) out.push({ check: 'IDEMPOTENCY', severity: 'LOW', entityType: 'IdempotencyRecord', entityId: s._id.toString(), message: `Pending record ${s.key} older than 10 minutes (crashed checkout?)`, repairable: false });
    return out;
  }

  /** Repair BATCH_BALANCE by posting a compensating ADJUSTMENT so ledger == on-hand. Audited. */
  async repair(dto: RepairDto, actor: AuthUser, requestId: string) {
    return this.tx.withTransaction(async (session) => {
      const batch = await this.batches.findById(dto.entityId).session(session).lean();
      if (!batch) throw new NotFoundError('Batch', dto.entityId);
      const [sum] = await this.movements.aggregate<{ total: number }>([{ $match: { batchId: batch._id } }, { $group: { _id: null, total: { $sum: '$quantityUnits' } } }]).session(session);
      const ledgerTotal = sum?.total ?? 0;
      const delta = batch.onHandUnits - ledgerTotal;
      if (delta === 0) throw new DomainError(ErrorCodes.INVALID_STATE_TRANSITION, 'Batch is already consistent');
      // Set the cached balance to the ledger first, then post the delta so the ledger row has correct balanceAfter.
      await this.batches.updateOne({ _id: batch._id }, { $set: { onHandUnits: ledgerTotal } }, { session });
      const movement = await this.ledger.postMovement({ batchId: batch._id, type: 'REVERSAL', quantityUnits: delta, sourceType: 'Reconciliation', reason: `Repair: ${dto.reason}`, actorId: actor.id, requestId, allowIneligible: true }, session);
      await this.audit.record({ actorId: actor.id, actorName: actor.name, action: 'reconciliation.repair', entityType: 'Batch', entityId: batch._id, before: { ledgerTotal, onHandUnits: batch.onHandUnits }, after: { compensatingUnits: delta }, reason: dto.reason, requestId }, session);
      return { batchId: batch._id.toString(), compensatingUnits: delta, movementId: movement._id.toString() };
    });
  }
}

@ApiTags('reconciliation')
@ApiBearerAuth()
@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly service: ReconciliationService) {}

  @Get('run') @RequirePermissions('reconciliation.run')
  @ApiOperation({ summary: 'Run all integrity checks (read-only).' })
  run() {
    return this.service.run();
  }

  @Post('repair') @RequirePermissions('reconciliation.repair')
  @ApiOperation({ summary: 'Post a compensating ledger entry for a repairable discrepancy.' })
  repair(@Body() dto: RepairDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.repair(dto, a, r);
  }
}

@Module({ imports: [InventoryModule], controllers: [ReconciliationController], providers: [ReconciliationService], exports: [ReconciliationService] })
export class ReconciliationModule {}
