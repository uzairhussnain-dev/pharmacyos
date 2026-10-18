import { Doc } from '../../common/types';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { AuthUser } from '../../common/decorators';
import { DomainError, ErrorCodes, NotFoundError } from '../../common/errors';
import { escapeRegex, paginate } from '../../common/pagination';
import { CounterService } from '../../database/schemas.module';
import { TransactionService } from '../../database/database.module';
import { Batch, BatchDocument, startOfDay } from '../../database/schemas/batch.schema';
import { Product, ProductDocument } from '../../database/schemas/product.schema';
import { StockMovement, StockMovementDocument } from '../../database/schemas/stock-movement.schema';
import { StockCount, StockCountDocument } from '../../database/schemas/system.schema';
import { AuditService } from '../audit/audit.module';
import { AdjustStockDto, BatchQuery, BatchStatusDto, CreateCountDto, MovementQuery, RejectCountDto } from './inventory.dto';
import { StockLedgerService } from './stock-ledger.service';

export function toBatchDto(b: Batch & { _id: Types.ObjectId; productId: Types.ObjectId | ProductDocument }) {
  const p = b.productId as Partial<Product> & { _id?: Types.ObjectId };
  const populated = p && typeof p === 'object' && 'brandName' in p;
  return {
    id: b._id.toString(),
    productId: populated ? p._id!.toString() : String(b.productId),
    product: populated
      ? { id: p._id!.toString(), sku: p.sku, brandName: p.brandName, genericName: p.genericName, strength: p.strength, baseUnit: p.baseUnit }
      : undefined,
    batchNumber: b.batchNumber,
    supplierLot: b.supplierLot,
    expiryDate: b.expiryDate,
    expiryPrecision: b.expiryPrecision,
    purchaseCostMinor: b.purchaseCostMinor,
    landedUnitCostMinor: b.landedUnitCostMinor,
    receivedUnits: b.receivedUnits,
    onHandUnits: b.onHandUnits,
    reservedUnits: b.reservedUnits,
    status: b.status,
    statusReason: b.statusReason,
    receiptId: b.receiptId?.toString(),
    supplierId: b.supplierId?.toString(),
    receivedAt: b.receivedAt,
    createdAt: b.createdAt,
  };
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectModel(Batch.name) private readonly batches: Model<BatchDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(StockMovement.name) private readonly movements: Model<StockMovementDocument>,
    @InjectModel(StockCount.name) private readonly counts: Model<StockCountDocument>,
    private readonly ledger: StockLedgerService,
    private readonly tx: TransactionService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
  ) {}

  async summary() {
    const today = startOfDay(new Date());
    const in30 = new Date(today.getTime() + 30 * 86400_000);
    const in90 = new Date(today.getTime() + 90 * 86400_000);
    const [agg] = await this.batches.aggregate<{
      totalUnits: number;
      costValueMinor: number;
      expired: number;
      expiredValueMinor: number;
      exp30ValueMinor: number;
      exp90ValueMinor: number;
      quarantined: number;
      quarantinedValueMinor: number;
    }>([
      { $match: { onHandUnits: { $gt: 0 } } },
      {
        $project: {
          onHandUnits: 1,
          value: { $multiply: ['$onHandUnits', '$landedUnitCostMinor'] },
          isExpired: { $lte: ['$expiryDate', today] },
          isExp30: { $and: [{ $gt: ['$expiryDate', today] }, { $lte: ['$expiryDate', in30] }] },
          isExp90: { $and: [{ $gt: ['$expiryDate', today] }, { $lte: ['$expiryDate', in90] }] },
          isQuarantined: { $in: ['$status', ['QUARANTINED', 'RECALLED']] },
        },
      },
      {
        $group: {
          _id: null,
          totalUnits: { $sum: '$onHandUnits' },
          costValueMinor: { $sum: '$value' },
          expired: { $sum: { $cond: ['$isExpired', 1, 0] } },
          expiredValueMinor: { $sum: { $cond: ['$isExpired', '$value', 0] } },
          exp30ValueMinor: { $sum: { $cond: ['$isExp30', '$value', 0] } },
          exp90ValueMinor: { $sum: { $cond: ['$isExp90', '$value', 0] } },
          quarantined: { $sum: { $cond: ['$isQuarantined', 1, 0] } },
          quarantinedValueMinor: { $sum: { $cond: ['$isQuarantined', '$value', 0] } },
        },
      },
    ]);
    const [productCount, lowStock, outOfStock] = await Promise.all([
      this.products.countDocuments({ isActive: true }),
      this.products.countDocuments({ isActive: true, reorderLevel: { $gt: 0 }, $expr: { $lte: ['$eligibleUnits', '$reorderLevel'] } }),
      this.products.countDocuments({ isActive: true, eligibleUnits: { $lte: 0 } }),
    ]);
    return {
      activeProducts: productCount,
      totalUnits: agg?.totalUnits ?? 0,
      inventoryCostValueMinor: agg?.costValueMinor ?? 0,
      expiredBatches: agg?.expired ?? 0,
      expiredValueMinor: agg?.expiredValueMinor ?? 0,
      expiringWithin30DaysValueMinor: agg?.exp30ValueMinor ?? 0,
      expiringWithin90DaysValueMinor: agg?.exp90ValueMinor ?? 0,
      quarantinedBatches: agg?.quarantined ?? 0,
      quarantinedValueMinor: agg?.quarantinedValueMinor ?? 0,
      lowStockProducts: lowStock,
      outOfStockProducts: outOfStock,
    };
  }

  async listBatches(query: BatchQuery) {
    const filter: FilterQuery<BatchDocument> = {};
    if (query.productId) filter.productId = new Types.ObjectId(query.productId);
    if (query.status) filter.status = query.status;
    if (query.inStock === 'true') filter.onHandUnits = { $gt: 0 };
    if (query.expiringWithinDays !== undefined) {
      filter.expiryDate = { $lte: new Date(Date.now() + query.expiringWithinDays * 86400_000) };
    }
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), 'i');
      const ids = await this.products.find({ $or: [{ brandName: rx }, { genericName: rx }, { sku: rx }] }).distinct('_id');
      filter.$or = [{ batchNumber: rx }, { productId: { $in: ids } }];
    }
    const [items, total] = await Promise.all([
      this.batches.find(filter).sort({ expiryDate: 1 }).skip(query.skip).limit(query.pageSize).populate('productId').lean(),
      this.batches.countDocuments(filter),
    ]);
    return paginate(items.map((b) => toBatchDto(b as never)), total, query);
  }

  async getBatch(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Batch', id);
    const b = await this.batches.findById(id).populate('productId').lean();
    if (!b) throw new NotFoundError('Batch', id);
    const movements = await this.movements.find({ batchId: b._id }).sort({ createdAt: -1 }).limit(100).populate('actorId', 'name').lean();
    return { ...toBatchDto(b as never), movements: movements.map(toMovementDto) };
  }

  async listMovements(query: MovementQuery) {
    const filter: FilterQuery<StockMovementDocument> = {};
    if (query.productId) filter.productId = new Types.ObjectId(query.productId);
    if (query.batchId) filter.batchId = new Types.ObjectId(query.batchId);
    if (query.type) filter.type = query.type;
    if (query.from || query.to) {
      filter.createdAt = {};
      if (query.from) filter.createdAt.$gte = new Date(query.from);
      if (query.to) filter.createdAt.$lte = new Date(query.to);
    }
    const [items, total] = await Promise.all([
      this.movements
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.pageSize)
        .populate('actorId', 'name')
        .populate('productId', 'brandName sku baseUnit')
        .populate('batchId', 'batchNumber expiryDate')
        .lean(),
      this.movements.countDocuments(filter),
    ]);
    return paginate(items.map(toMovementDto), total, query);
  }

  async adjust(dto: AdjustStockDto, actor: AuthUser, requestId: string) {
    return this.tx.withTransaction(async (session) => {
      const movement = await this.ledger.postMovement(
        {
          batchId: dto.batchId,
          type: 'ADJUSTMENT',
          quantityUnits: dto.quantityUnits,
          sourceType: 'Adjustment',
          reason: dto.reason,
          actorId: actor.id,
          requestId,
          allowIneligible: true,
        },
        session,
      );
      await this.audit.record(
        {
          actorId: actor.id,
          actorName: actor.name,
          action: 'inventory.adjust',
          entityType: 'Batch',
          entityId: dto.batchId,
          after: { quantityUnits: dto.quantityUnits, balanceAfterUnits: movement.balanceAfterUnits },
          reason: dto.reason,
          requestId,
        },
        session,
      );
      return toMovementDto(movement.toObject());
    });
  }

  async setBatchStatus(id: string, dto: BatchStatusDto, actor: AuthUser, requestId: string) {
    return this.tx.withTransaction(async (session) => {
      const before = await this.batches.findById(id).session(session).lean();
      if (!before) throw new NotFoundError('Batch', id);
      if (before.status === 'DEPLETED' || before.status === 'RETURNED') {
        throw new DomainError(ErrorCodes.INVALID_STATE_TRANSITION, `Cannot change status of a ${before.status} batch`);
      }
      const batch = await this.ledger.setBatchStatus(id, dto.status, dto.reason, session);
      await this.audit.record(
        {
          actorId: actor.id,
          actorName: actor.name,
          action: `batch.status.${dto.status.toLowerCase()}`,
          entityType: 'Batch',
          entityId: id,
          before: { status: before.status },
          after: { status: dto.status },
          reason: dto.reason,
          requestId,
        },
        session,
      );
      return toBatchDto(batch.toObject() as never);
    });
  }

  // ---------- Stock counts ----------

  async listCounts(query: { page: number; pageSize: number; skip: number; status?: string }) {
    const filter: FilterQuery<StockCountDocument> = {};
    if (query.status) filter.status = query.status;
    const [items, total] = await Promise.all([
      this.counts.find(filter).sort({ createdAt: -1 }).skip(query.skip).limit(query.pageSize).populate('createdById', 'name').lean(),
      this.counts.countDocuments(filter),
    ]);
    return paginate(items.map(toCountDto), total, query);
  }

  async getCount(id: string) {
    const c = await this.counts.findById(id).populate('createdById approvedById submittedById', 'name').lean();
    if (!c) throw new NotFoundError('StockCount', id);
    return toCountDto(c);
  }

  async createCount(dto: CreateCountDto, actor: AuthUser, requestId: string) {
    const batchIds = dto.lines.map((l) => new Types.ObjectId(l.batchId));
    const batches = await this.batches.find({ _id: { $in: batchIds } }).populate('productId', 'brandName').lean();
    const byId = new Map(batches.map((b) => [b._id.toString(), b]));
    const lines = dto.lines.map((l) => {
      const b = byId.get(l.batchId);
      if (!b) throw new NotFoundError('Batch', l.batchId);
      return {
        batchId: b._id,
        productId: (b.productId as unknown as { _id: Types.ObjectId })._id,
        productName: (b.productId as unknown as { brandName: string }).brandName,
        batchNumber: b.batchNumber,
        systemUnits: b.onHandUnits,
        countedUnits: l.countedUnits,
        note: l.note,
      };
    });
    const count = await this.counts.create({
      countNumber: await this.counters.nextNumber('CNT'),
      status: 'DRAFT',
      lines,
      notes: dto.notes,
      createdById: new Types.ObjectId(actor.id),
    });
    await this.audit.record({
      actorId: actor.id,
      actorName: actor.name,
      action: 'stockcount.create',
      entityType: 'StockCount',
      entityId: count._id,
      after: { countNumber: count.countNumber, lines: lines.length },
      requestId,
    });
    return toCountDto(count.toObject());
  }

  async submitCount(id: string, actor: AuthUser, requestId: string) {
    const count = await this.counts.findById(id);
    if (!count) throw new NotFoundError('StockCount', id);
    if (count.status !== 'DRAFT') throw new DomainError(ErrorCodes.INVALID_STATE_TRANSITION, `Count is ${count.status}`);
    // Refresh system quantities at submission so the variance is against the current ledger.
    const batches = await this.batches.find({ _id: { $in: count.lines.map((l) => l.batchId) } }).lean();
    const byId = new Map(batches.map((b) => [b._id.toString(), b.onHandUnits]));
    for (const line of count.lines) line.systemUnits = byId.get(line.batchId.toString()) ?? line.systemUnits;
    count.status = 'SUBMITTED';
    count.submittedById = new Types.ObjectId(actor.id);
    count.submittedAt = new Date();
    await count.save();
    await this.audit.record({
      actorId: actor.id,
      actorName: actor.name,
      action: 'stockcount.submit',
      entityType: 'StockCount',
      entityId: count._id,
      requestId,
    });
    return toCountDto(count.toObject());
  }

  /** Approving posts COUNT_ADJUSTMENT movements for every line with a variance, in one transaction. */
  async approveCount(id: string, actor: AuthUser, requestId: string) {
    return this.tx.withTransaction(async (session) => {
      const count = await this.counts.findById(id).session(session);
      if (!count) throw new NotFoundError('StockCount', id);
      if (count.status !== 'SUBMITTED') throw new DomainError(ErrorCodes.INVALID_STATE_TRANSITION, `Count is ${count.status}`);
      if (count.submittedById?.toString() === actor.id && actor.role !== 'OWNER') {
        throw new DomainError(ErrorCodes.FORBIDDEN, 'A count must be approved by someone other than the submitter');
      }
      let adjustments = 0;
      for (const line of count.lines) {
        const current = await this.batches.findById(line.batchId).session(session).lean();
        if (!current) continue;
        const delta = line.countedUnits - current.onHandUnits;
        if (delta === 0) continue;
        await this.ledger.postMovement(
          {
            batchId: line.batchId,
            type: 'COUNT_ADJUSTMENT',
            quantityUnits: delta,
            sourceType: 'StockCount',
            sourceId: count._id,
            reason: `Stock count ${count.countNumber}: system ${current.onHandUnits}, counted ${line.countedUnits}`,
            actorId: actor.id,
            requestId,
            allowIneligible: true,
          },
          session,
        );
        line.systemUnits = current.onHandUnits;
        adjustments += 1;
      }
      count.status = 'APPROVED';
      count.approvedById = new Types.ObjectId(actor.id);
      count.approvedAt = new Date();
      await count.save({ session });
      await this.audit.record(
        {
          actorId: actor.id,
          actorName: actor.name,
          action: 'stockcount.approve',
          entityType: 'StockCount',
          entityId: count._id,
          after: { adjustments },
          requestId,
        },
        session,
      );
      return toCountDto(count.toObject());
    });
  }

  async rejectCount(id: string, dto: RejectCountDto, actor: AuthUser, requestId: string) {
    const count = await this.counts.findById(id);
    if (!count) throw new NotFoundError('StockCount', id);
    if (count.status !== 'SUBMITTED') throw new DomainError(ErrorCodes.INVALID_STATE_TRANSITION, `Count is ${count.status}`);
    count.status = 'REJECTED';
    count.rejectionReason = dto.reason;
    await count.save();
    await this.audit.record({
      actorId: actor.id,
      actorName: actor.name,
      action: 'stockcount.reject',
      entityType: 'StockCount',
      entityId: count._id,
      reason: dto.reason,
      requestId,
    });
    return toCountDto(count.toObject());
  }
}

export function toMovementDto(m: Doc) {
  const actor = m.actorId as { _id?: Types.ObjectId; name?: string } | Types.ObjectId;
  const product = m.productId as { _id?: Types.ObjectId; brandName?: string; sku?: string; baseUnit?: string } | Types.ObjectId;
  const batch = m.batchId as { _id?: Types.ObjectId; batchNumber?: string; expiryDate?: Date } | Types.ObjectId;
  const idOf = (v: unknown) => (v && typeof v === 'object' && '_id' in (v as object) ? String((v as { _id: unknown })._id) : String(v));
  return {
    id: String(m._id),
    productId: idOf(product),
    productName: (product as { brandName?: string })?.brandName,
    productSku: (product as { sku?: string })?.sku,
    baseUnit: (product as { baseUnit?: string })?.baseUnit,
    batchId: idOf(batch),
    batchNumber: (batch as { batchNumber?: string })?.batchNumber,
    type: m.type,
    quantityUnits: m.quantityUnits,
    unitCostMinor: m.unitCostMinor,
    balanceAfterUnits: m.balanceAfterUnits,
    sourceType: m.sourceType,
    sourceId: m.sourceId ? String(m.sourceId) : undefined,
    reason: m.reason,
    actorId: idOf(actor),
    actorName: (actor as { name?: string })?.name,
    requestId: m.requestId,
    createdAt: m.createdAt,
  };
}

function toCountDto(c: Doc) {
  const nameOf = (v: unknown) => (v && typeof v === 'object' && 'name' in (v as object) ? (v as { name: string }).name : undefined);
  const lines = (c.lines as Array<Record<string, unknown>>).map((l) => ({
    batchId: String(l.batchId),
    productId: String(l.productId),
    productName: l.productName,
    batchNumber: l.batchNumber,
    systemUnits: l.systemUnits,
    countedUnits: l.countedUnits,
    varianceUnits: (l.countedUnits as number) - (l.systemUnits as number),
    note: l.note,
  }));
  return {
    id: String(c._id),
    countNumber: c.countNumber,
    status: c.status,
    lines,
    discrepancies: lines.filter((l) => l.varianceUnits !== 0).length,
    notes: c.notes,
    createdByName: nameOf(c.createdById),
    submittedByName: nameOf(c.submittedById),
    approvedByName: nameOf(c.approvedById),
    submittedAt: c.submittedAt,
    approvedAt: c.approvedAt,
    rejectionReason: c.rejectionReason,
    createdAt: c.createdAt,
  };
}
