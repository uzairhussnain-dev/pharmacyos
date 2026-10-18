import { Doc } from '../../common/types';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { AuthUser } from '../../common/decorators';
import { DomainError, ErrorCodes, NotFoundError } from '../../common/errors';
import { paginate } from '../../common/pagination';
import { TransactionService } from '../../database/database.module';
import { CounterService } from '../../database/schemas.module';
import { Batch, BatchDocument } from '../../database/schemas/batch.schema';
import { SupplierPayment, SupplierPaymentDocument } from '../../database/schemas/finance.schema';
import { Product, ProductDocument } from '../../database/schemas/product.schema';
import {
  GoodsReceipt,
  GoodsReceiptDocument,
  PurchaseOrder,
  PurchaseOrderDocument,
  PurchaseReturn,
  PurchaseReturnDocument,
  Supplier,
  SupplierDocument,
} from '../../database/schemas/purchasing.schema';
import { AuditService } from '../audit/audit.module';
import { StockLedgerService } from '../inventory/stock-ledger.service';
import {
  CreatePurchaseOrderDto,
  CreatePurchaseReturnDto,
  DirectReceiveDto,
  PoQuery,
  ReceiveDto,
  ReceiveLineDto,
  SupplierPaymentDto,
  UpdatePurchaseOrderDto,
} from './purchasing.dto';

/** Normalise expiry: MONTH precision → last day of month, 23:59:59.999 local. DAY → end of that day. */
export function normalizeExpiry(iso: string, precision: 'DAY' | 'MONTH' = 'DAY'): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new DomainError(ErrorCodes.VALIDATION_FAILED, `Invalid expiry date ${iso}`);
  if (precision === 'MONTH') return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

@Injectable()
export class PurchasingService {
  constructor(
    @InjectModel(PurchaseOrder.name) private readonly pos: Model<PurchaseOrderDocument>,
    @InjectModel(GoodsReceipt.name) private readonly grns: Model<GoodsReceiptDocument>,
    @InjectModel(PurchaseReturn.name) private readonly returns: Model<PurchaseReturnDocument>,
    @InjectModel(SupplierPayment.name) private readonly payments: Model<SupplierPaymentDocument>,
    @InjectModel(Batch.name) private readonly batches: Model<BatchDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Supplier.name) private readonly suppliers: Model<SupplierDocument>,
    private readonly ledger: StockLedgerService,
    private readonly tx: TransactionService,
    private readonly counters: CounterService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Purchase orders ----------

  async listOrders(query: PoQuery) {
    const filter: FilterQuery<PurchaseOrderDocument> = {};
    if (query.status) filter.status = query.status;
    if (query.supplierId) filter.supplierId = new Types.ObjectId(query.supplierId);
    if (query.q) filter.poNumber = new RegExp(query.q, 'i');
    const [items, total] = await Promise.all([
      this.pos.find(filter).sort({ createdAt: -1 }).skip(query.skip).limit(query.pageSize).populate('supplierId', 'name').lean(),
      this.pos.countDocuments(filter),
    ]);
    return paginate(items.map(toPoDto), total, query);
  }

  async getOrder(id: string) {
    const po = await this.pos.findById(id).populate('supplierId', 'name leadTimeDays').populate('createdById', 'name').lean();
    if (!po) throw new NotFoundError('PurchaseOrder', id);
    const receipts = await this.grns.find({ purchaseOrderId: po._id }).sort({ createdAt: -1 }).lean();
    return { ...toPoDto(po), receipts: receipts.map(toGrnDto) };
  }

  async createOrder(dto: CreatePurchaseOrderDto, actor: AuthUser, requestId: string) {
    const supplier = await this.suppliers.findById(dto.supplierId).lean();
    if (!supplier || !supplier.isActive) throw new NotFoundError('Supplier', dto.supplierId);
    const lines = await this.buildPoLines(dto.lines);
    const po = await this.pos.create({
      poNumber: await this.counters.nextNumber('PO'),
      supplierId: supplier._id,
      lines,
      expectedDeliveryDate: dto.expectedDeliveryDate
        ? new Date(dto.expectedDeliveryDate)
        : new Date(Date.now() + (supplier.leadTimeDays || 7) * 86400_000),
      totalMinor: lines.reduce((a, l) => a + l.quantityUnits * l.unitCostMinor, 0),
      notes: dto.notes,
      createdById: new Types.ObjectId(actor.id),
    });
    await this.audit.record({ actorId: actor.id, actorName: actor.name, action: 'po.create', entityType: 'PurchaseOrder', entityId: po._id, after: { poNumber: po.poNumber, totalMinor: po.totalMinor, lines: lines.length }, requestId });
    return toPoDto(po.toObject());
  }

  async updateOrder(id: string, dto: UpdatePurchaseOrderDto, actor: AuthUser, requestId: string) {
    const po = await this.pos.findById(id);
    if (!po) throw new NotFoundError('PurchaseOrder', id);
    if (dto.status === 'CANCELLED') {
      if (!['DRAFT', 'SUBMITTED'].includes(po.status)) {
        throw new DomainError(ErrorCodes.INVALID_STATE_TRANSITION, `Cannot cancel a ${po.status} order`);
      }
      po.status = 'CANCELLED';
    } else {
      if (po.status !== 'DRAFT') throw new DomainError(ErrorCodes.INVALID_STATE_TRANSITION, 'Only DRAFT orders can be edited');
      if (dto.lines) {
        po.lines = await this.buildPoLines(dto.lines);
        po.totalMinor = po.lines.reduce((a, l) => a + l.quantityUnits * l.unitCostMinor, 0);
      }
      if (dto.expectedDeliveryDate) po.expectedDeliveryDate = new Date(dto.expectedDeliveryDate);
      if (dto.notes !== undefined) po.notes = dto.notes;
    }
    await po.save();
    await this.audit.record({ actorId: actor.id, actorName: actor.name, action: dto.status === 'CANCELLED' ? 'po.cancel' : 'po.update', entityType: 'PurchaseOrder', entityId: po._id, after: { status: po.status, totalMinor: po.totalMinor }, requestId });
    return toPoDto(po.toObject());
  }

  async submitOrder(id: string, actor: AuthUser, requestId: string) {
    const po = await this.pos.findById(id);
    if (!po) throw new NotFoundError('PurchaseOrder', id);
    if (po.status !== 'DRAFT') throw new DomainError(ErrorCodes.INVALID_STATE_TRANSITION, `Order is ${po.status}`);
    po.status = 'SUBMITTED';
    po.submittedAt = new Date();
    await po.save();
    await this.audit.record({ actorId: actor.id, actorName: actor.name, action: 'po.submit', entityType: 'PurchaseOrder', entityId: po._id, requestId });
    return toPoDto(po.toObject());
  }

  private async buildPoLines(lines: { productId: string; quantityUnits: number; unitCostMinor: number }[]) {
    const ids = lines.map((l) => new Types.ObjectId(l.productId));
    const products = await this.products.find({ _id: { $in: ids } }).lean();
    const byId = new Map(products.map((p) => [p._id.toString(), p]));
    return lines.map((l) => {
      const p = byId.get(l.productId);
      if (!p) throw new NotFoundError('Product', l.productId);
      return { productId: p._id, productName: `${p.brandName}${p.strength ? ' ' + p.strength : ''}`, quantityUnits: l.quantityUnits, receivedUnits: 0, unitCostMinor: l.unitCostMinor };
    });
  }

  // ---------- Goods receipts ----------

  /**
   * Receiving against a PO: creates batches, posts RECEIPT movements, updates PO received quantities
   * and status — all in one transaction. Purchase orders never change stock; only this does.
   */
  async receiveOrder(poId: string, dto: ReceiveDto, actor: AuthUser, requestId: string) {
    return this.tx.withTransaction(async (session) => {
      const po = await this.pos.findById(poId).session(session);
      if (!po) throw new NotFoundError('PurchaseOrder', poId);
      if (!['SUBMITTED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
        throw new DomainError(ErrorCodes.INVALID_STATE_TRANSITION, `Cannot receive against a ${po.status} order`);
      }
      // Over-receipt protection per product
      const remaining = new Map<string, number>();
      for (const l of po.lines) remaining.set(l.productId.toString(), l.quantityUnits - l.receivedUnits);
      for (const l of dto.lines) {
        const rem = remaining.get(l.productId);
        if (rem === undefined) throw new DomainError(ErrorCodes.VALIDATION_FAILED, `Product ${l.productId} is not on this order`);
        if (l.quantityUnits > rem) {
          throw new DomainError(ErrorCodes.VALIDATION_FAILED, `Receiving ${l.quantityUnits} exceeds remaining ${rem} for product ${l.productId}`);
        }
        remaining.set(l.productId, rem - l.quantityUnits);
      }
      const grn = await this.createReceipt({ ...dto, supplierId: po.supplierId.toString() }, po._id, actor, requestId, session);
      for (const l of dto.lines) {
        const line = po.lines.find((x) => x.productId.toString() === l.productId)!;
        line.receivedUnits += l.quantityUnits;
      }
      const fullyReceived = po.lines.every((l) => l.receivedUnits >= l.quantityUnits);
      po.status = fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      await po.save({ session });
      return { purchaseOrder: toPoDto(po.toObject()), receipt: grn };
    });
  }

  async receiveDirect(dto: DirectReceiveDto, actor: AuthUser, requestId: string) {
    return this.tx.withTransaction(async (session) => this.createReceipt(dto, undefined, actor, requestId, session));
  }

  private async createReceipt(dto: DirectReceiveDto, poId: Types.ObjectId | undefined, actor: AuthUser, requestId: string, session: ClientSession) {
    const supplier = await this.suppliers.findById(dto.supplierId).session(session).lean();
    if (!supplier) throw new NotFoundError('Supplier', dto.supplierId);
    const productIds = [...new Set(dto.lines.map((l) => l.productId))].map((s) => new Types.ObjectId(s));
    const products = await this.products.find({ _id: { $in: productIds } }).session(session).lean();
    const byId = new Map(products.map((p) => [p._id.toString(), p]));

    const grnNumber = await this.counters.nextNumber('GRN', session);
    const grnId = new Types.ObjectId();
    const lines: GoodsReceipt['lines'] = [];
    let totalCost = 0;
    const today = new Date();

    for (const l of dto.lines) {
      const p = byId.get(l.productId);
      if (!p) throw new NotFoundError('Product', l.productId);
      const expiry = normalizeExpiry(l.expiryDate, l.expiryPrecision ?? 'DAY');
      if (p.tracksExpiry && expiry.getTime() <= today.getTime()) {
        throw new DomainError(ErrorCodes.BATCH_INELIGIBLE, `Cannot receive already-expired stock for ${p.brandName} (batch ${l.batchNumber})`);
      }
      const landed = l.landedUnitCostMinor ?? l.unitCostMinor;
      const [batch] = await this.batches.create(
        [
          {
            productId: p._id,
            batchNumber: l.batchNumber,
            supplierLot: l.supplierLot,
            expiryDate: expiry,
            expiryPrecision: l.expiryPrecision ?? 'DAY',
            purchaseCostMinor: l.unitCostMinor,
            landedUnitCostMinor: landed,
            receivedUnits: l.quantityUnits,
            onHandUnits: 0,
            reservedUnits: 0,
            status: 'ACTIVE',
            receiptId: grnId,
            supplierId: supplier._id,
            receivedAt: today,
            createdById: new Types.ObjectId(actor.id),
          },
        ],
        { session },
      );
      await this.ledger.postMovement(
        { batchId: batch._id, type: 'RECEIPT', quantityUnits: l.quantityUnits, unitCostMinor: landed, sourceType: 'GoodsReceipt', sourceId: grnId, actorId: actor.id, requestId },
        session,
      );
      lines.push({ productId: p._id, batchId: batch._id, batchNumber: batch.batchNumber, expiryDate: expiry, quantityUnits: l.quantityUnits, unitCostMinor: l.unitCostMinor, landedUnitCostMinor: landed });
      totalCost += l.quantityUnits * l.unitCostMinor;
    }

    const [grn] = await this.grns.create(
      [{ _id: grnId, grnNumber, purchaseOrderId: poId, supplierId: supplier._id, lines, status: 'ACCEPTED', supplierInvoiceNumber: dto.supplierInvoiceNumber, totalCostMinor: totalCost, paidMinor: 0, receivedById: new Types.ObjectId(actor.id), notes: dto.notes }],
      { session },
    );
    await this.audit.record(
      { actorId: actor.id, actorName: actor.name, action: 'grn.accept', entityType: 'GoodsReceipt', entityId: grnId, after: { grnNumber, totalCostMinor: totalCost, lines: lines.length, purchaseOrderId: poId?.toString() }, requestId },
      session,
    );
    return toGrnDto(grn.toObject());
  }

  async listReceipts(query: PoQuery) {
    const filter: FilterQuery<GoodsReceiptDocument> = {};
    if (query.supplierId) filter.supplierId = new Types.ObjectId(query.supplierId);
    if (query.q) filter.grnNumber = new RegExp(query.q, 'i');
    const [items, total] = await Promise.all([
      this.grns.find(filter).sort({ createdAt: -1 }).skip(query.skip).limit(query.pageSize).populate('supplierId', 'name').lean(),
      this.grns.countDocuments(filter),
    ]);
    return paginate(items.map(toGrnDto), total, query);
  }

  async getReceipt(id: string) {
    const grn = await this.grns.findById(id).populate('supplierId', 'name').populate('receivedById', 'name').populate('lines.productId', 'brandName sku strength baseUnit').lean();
    if (!grn) throw new NotFoundError('GoodsReceipt', id);
    const payments = await this.payments.find({ goodsReceiptId: grn._id }).sort({ createdAt: -1 }).lean();
    return { ...toGrnDto(grn), payments: payments.map((p) => ({ ...p, id: p._id.toString() })) };
  }

  async paySupplier(dto: SupplierPaymentDto, actor: AuthUser, requestId: string) {
    return this.tx.withTransaction(async (session) => {
      const grn = await this.grns.findOneAndUpdate(
        { _id: new Types.ObjectId(dto.goodsReceiptId), status: 'ACCEPTED', $expr: { $lte: [{ $add: ['$paidMinor', dto.amountMinor] }, '$totalCostMinor'] } },
        { $inc: { paidMinor: dto.amountMinor } },
        { new: true, session },
      );
      if (!grn) {
        const exists = await this.grns.findById(dto.goodsReceiptId).session(session).lean();
        if (!exists) throw new NotFoundError('GoodsReceipt', dto.goodsReceiptId);
        throw new DomainError(ErrorCodes.PAYMENT_MISMATCH, `Payment exceeds outstanding balance (${exists.totalCostMinor - exists.paidMinor})`);
      }
      const [payment] = await this.payments.create(
        [{ supplierId: grn.supplierId, goodsReceiptId: grn._id, amountMinor: dto.amountMinor, method: dto.method, reference: dto.reference, actorId: new Types.ObjectId(actor.id) }],
        { session },
      );
      await this.audit.record({ actorId: actor.id, actorName: actor.name, action: 'supplier.payment', entityType: 'GoodsReceipt', entityId: grn._id, after: { amountMinor: dto.amountMinor, method: dto.method }, requestId }, session);
      return { id: payment._id.toString(), receipt: toGrnDto(grn.toObject()) };
    });
  }

  // ---------- Purchase returns ----------

  async createReturn(dto: CreatePurchaseReturnDto, actor: AuthUser, requestId: string) {
    const supplier = await this.suppliers.findById(dto.supplierId).lean();
    if (!supplier) throw new NotFoundError('Supplier', dto.supplierId);
    const batches = await this.batches.find({ _id: { $in: dto.lines.map((l) => new Types.ObjectId(l.batchId)) } }).lean();
    const byId = new Map(batches.map((b) => [b._id.toString(), b]));
    const lines = dto.lines.map((l) => {
      const b = byId.get(l.batchId);
      if (!b) throw new NotFoundError('Batch', l.batchId);
      if (b.supplierId && b.supplierId.toString() !== dto.supplierId) {
        throw new DomainError(ErrorCodes.VALIDATION_FAILED, `Batch ${b.batchNumber} was not supplied by this supplier`);
      }
      if (l.quantityUnits > b.onHandUnits) {
        throw new DomainError(ErrorCodes.INSUFFICIENT_STOCK, `Batch ${b.batchNumber} only has ${b.onHandUnits} units`);
      }
      return { batchId: b._id, productId: b.productId, quantityUnits: l.quantityUnits, unitCostMinor: b.purchaseCostMinor };
    });
    const pr = await this.returns.create({
      prNumber: await this.counters.nextNumber('PR'),
      supplierId: supplier._id,
      lines,
      reason: dto.reason,
      status: 'DRAFT',
      totalMinor: lines.reduce((a, l) => a + l.quantityUnits * l.unitCostMinor, 0),
      createdById: new Types.ObjectId(actor.id),
    });
    await this.audit.record({ actorId: actor.id, actorName: actor.name, action: 'purchase_return.create', entityType: 'PurchaseReturn', entityId: pr._id, after: { prNumber: pr.prNumber, totalMinor: pr.totalMinor }, reason: dto.reason, requestId });
    return toPrDto(pr.toObject());
  }

  /** Finalizing posts PURCHASE_RETURN outbound movements (allowed even for expired/quarantined stock). */
  async finalizeReturn(id: string, actor: AuthUser, requestId: string) {
    return this.tx.withTransaction(async (session) => {
      const pr = await this.returns.findById(id).session(session);
      if (!pr) throw new NotFoundError('PurchaseReturn', id);
      if (pr.status !== 'DRAFT') throw new DomainError(ErrorCodes.INVALID_STATE_TRANSITION, `Return is ${pr.status}`);
      for (const l of pr.lines) {
        await this.ledger.postMovement(
          { batchId: l.batchId, type: 'PURCHASE_RETURN', quantityUnits: -l.quantityUnits, unitCostMinor: l.unitCostMinor, sourceType: 'PurchaseReturn', sourceId: pr._id, reason: pr.reason, actorId: actor.id, requestId, allowIneligible: true },
          session,
        );
      }
      pr.status = 'FINALIZED';
      pr.finalizedById = new Types.ObjectId(actor.id);
      pr.finalizedAt = new Date();
      await pr.save({ session });
      await this.audit.record({ actorId: actor.id, actorName: actor.name, action: 'purchase_return.finalize', entityType: 'PurchaseReturn', entityId: pr._id, after: { totalMinor: pr.totalMinor }, requestId }, session);
      return toPrDto(pr.toObject());
    });
  }

  async listReturns(query: PoQuery) {
    const filter: FilterQuery<PurchaseReturnDocument> = {};
    if (query.status) filter.status = query.status;
    if (query.supplierId) filter.supplierId = new Types.ObjectId(query.supplierId);
    const [items, total] = await Promise.all([
      this.returns.find(filter).sort({ createdAt: -1 }).skip(query.skip).limit(query.pageSize).populate('supplierId', 'name').populate('lines.productId', 'brandName').populate('lines.batchId', 'batchNumber').lean(),
      this.returns.countDocuments(filter),
    ]);
    return paginate(items.map(toPrDto), total, query);
  }
}

const nameOf = (v: unknown) => (v && typeof v === 'object' && 'name' in (v as object) ? (v as { name: string }).name : undefined);
const idOf = (v: unknown) => (v && typeof v === 'object' && '_id' in (v as object) ? String((v as { _id: unknown })._id) : v ? String(v) : undefined);

export function toPoDto(po: Doc) {
  const lines = po.lines as Array<Record<string, unknown>>;
  return {
    id: String(po._id),
    poNumber: po.poNumber,
    supplierId: idOf(po.supplierId),
    supplierName: nameOf(po.supplierId),
    status: po.status,
    lines: lines.map((l) => ({ ...l, productId: String(l.productId) })),
    expectedDeliveryDate: po.expectedDeliveryDate,
    totalMinor: po.totalMinor,
    notes: po.notes,
    createdById: idOf(po.createdById),
    createdByName: nameOf(po.createdById),
    submittedAt: po.submittedAt,
    createdAt: po.createdAt,
    updatedAt: po.updatedAt,
  };
}

export function toGrnDto(g: Doc) {
  const lines = g.lines as Array<Record<string, unknown>>;
  return {
    id: String(g._id),
    grnNumber: g.grnNumber,
    purchaseOrderId: g.purchaseOrderId ? String(g.purchaseOrderId) : undefined,
    supplierId: idOf(g.supplierId),
    supplierName: nameOf(g.supplierId),
    status: g.status,
    supplierInvoiceNumber: g.supplierInvoiceNumber,
    totalCostMinor: g.totalCostMinor,
    paidMinor: g.paidMinor,
    outstandingMinor: (g.totalCostMinor as number) - (g.paidMinor as number),
    lines: lines.map((l) => {
      const p = l.productId as Record<string, unknown>;
      const populated = p && typeof p === 'object' && 'brandName' in p;
      return { ...l, productId: idOf(l.productId), batchId: l.batchId ? String(l.batchId) : undefined, productName: populated ? `${p.brandName}${p.strength ? ' ' + p.strength : ''}` : undefined, sku: populated ? p.sku : undefined, baseUnit: populated ? p.baseUnit : undefined };
    }),
    receivedById: idOf(g.receivedById),
    receivedByName: nameOf(g.receivedById),
    notes: g.notes,
    createdAt: g.createdAt,
  };
}

function toPrDto(pr: Doc) {
  const lines = pr.lines as Array<Record<string, unknown>>;
  return {
    id: String(pr._id),
    prNumber: pr.prNumber,
    supplierId: idOf(pr.supplierId),
    supplierName: nameOf(pr.supplierId),
    status: pr.status,
    reason: pr.reason,
    totalMinor: pr.totalMinor,
    lines: lines.map((l) => ({
      batchId: idOf(l.batchId),
      batchNumber: (l.batchId as { batchNumber?: string })?.batchNumber,
      productId: idOf(l.productId),
      productName: (l.productId as { brandName?: string })?.brandName,
      quantityUnits: l.quantityUnits,
      unitCostMinor: l.unitCostMinor,
    })),
    finalizedAt: pr.finalizedAt,
    createdAt: pr.createdAt,
  };
}
