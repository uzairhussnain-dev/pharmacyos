import { Doc } from '../../common/types';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { ClientSession, Model, Types } from 'mongoose';
import { AuthUser } from '../../common/decorators';
import { AppException, DomainError, ErrorCodes, NotFoundError } from '../../common/errors';
import { isDuplicateKeyError } from '../../common/mongo-errors';
import { TransactionService } from '../../database/database.module';
import { CounterService } from '../../database/schemas.module';
import { Customer, CustomerDocument } from '../../database/schemas/finance.schema';
import { IdempotencyRecord, IdempotencyRecordDocument } from '../../database/schemas/idempotency.schema';
import { Product, ProductDocument } from '../../database/schemas/product.schema';
import { Payment, PaymentDocument, Sale, SaleDocument } from '../../database/schemas/sales.schema';
import { HeldCart, HeldCartDocument } from '../../database/schemas/system.schema';
import { AuditService } from '../audit/audit.module';
import { CashSessionsService } from '../cash-sessions/cash-sessions.module';
import { CustomersService } from '../customers/customers.module';
import { StockLedgerService, allocateFefo, Allocation } from '../inventory/stock-ledger.service';
import { SettingsService } from '../settings/settings.module';
import { toSaleDto } from '../sales/sales.mapper';
import { CheckoutDto, HoldCartDto, QuoteDto } from './pos.dto';
import { PricedCart, priceCart, settleTenders } from './pricing';

const IDEMPOTENCY_TTL_HOURS = 48;

@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);

  constructor(
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Sale.name) private readonly sales: Model<SaleDocument>,
    @InjectModel(Payment.name) private readonly payments: Model<PaymentDocument>,
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @InjectModel(IdempotencyRecord.name) private readonly idem: Model<IdempotencyRecordDocument>,
    @InjectModel(HeldCart.name) private readonly held: Model<HeldCartDocument>,
    private readonly ledger: StockLedgerService,
    private readonly cashSessions: CashSessionsService,
    private readonly customersService: CustomersService,
    private readonly settings: SettingsService,
    private readonly counters: CounterService,
    private readonly tx: TransactionService,
    private readonly audit: AuditService,
  ) {}

  private async policyFor(actor: AuthUser) {
    const s = await this.settings.get();
    return {
      maxDiscountBps: actor.permissions.includes('cash.reconcile') ? 10000 : s.maxCashierDiscountBps,
      canDiscount: actor.permissions.includes('pos.discount'),
      requirePrescriptionConfirmation: s.requirePrescriptionConfirmation,
      blockControlled: s.blockControlledSalesAtPos,
    };
  }

  private async loadProducts(lines: { productId: string }[], session?: ClientSession) {
    const ids = [...new Set(lines.map((l) => l.productId))].map((s) => new Types.ObjectId(s));
    const docs = await this.products.find({ _id: { $in: ids } }).session(session ?? null).lean();
    const byId = new Map(docs.map((p) => [p._id.toString(), p]));
    for (const l of lines) if (!byId.has(l.productId)) throw new NotFoundError('Product', l.productId);
    return byId;
  }

  /** Advisory quote: prices + availability per line. Never reserves stock. */
  async quote(dto: QuoteDto, actor: AuthUser) {
    const byId = await this.loadProducts(dto.lines);
    const policy = await this.policyFor(actor);
    const priced = priceCart(
      { lines: dto.lines.map((l) => ({ product: byId.get(l.productId)!, unitName: l.unitName, quantity: l.quantity, discountMinor: l.discountMinor, prescriptionVerified: l.prescriptionVerified })), orderDiscountMinor: dto.orderDiscountMinor },
      policy,
    );
    // Availability check (aggregated per product across lines)
    const needed = new Map<string, number>();
    for (const l of priced.lines) needed.set(l.productId, (needed.get(l.productId) ?? 0) + l.quantityUnits);
    const availability: Record<string, { eligibleUnits: number; sufficient: boolean; nearestExpiry?: Date; warnings: string[] }> = {};
    for (const [pid, qty] of needed) {
      const batches = await this.ledger.eligibleBatches(pid);
      const eligible = batches.reduce((a, b) => a + b.onHandUnits - b.reservedUnits, 0);
      const warnings: string[] = [];
      const nearest = batches[0]?.expiryDate;
      if (nearest && nearest.getTime() - Date.now() < 30 * 86400_000) warnings.push('Nearest batch expires within 30 days');
      const p = byId.get(pid)!;
      if (p.saleRestriction !== 'OTC') warnings.push(`${p.saleRestriction} item`);
      availability[pid] = { eligibleUnits: eligible, sufficient: eligible >= qty, nearestExpiry: nearest, warnings };
    }
    return { ...priced, availability, customer: dto.customerId ? await this.customerSummary(dto.customerId) : undefined };
  }

  private async customerSummary(id: string) {
    const c = await this.customers.findById(id).lean();
    if (!c) throw new NotFoundError('Customer', id);
    return { id: c._id.toString(), name: c.name, creditEnabled: c.creditEnabled, creditLimitMinor: c.creditLimitMinor, balanceMinor: c.balanceMinor, availableCreditMinor: Math.max(0, c.creditLimitMinor - c.balanceMinor) };
  }

  /**
   * Idempotent, transactional checkout. See docs/architecture.md#checkout.
   */
  async checkout(dto: CheckoutDto, actor: AuthUser, requestId: string) {
    const key = `${actor.id}:${dto.idempotencyKey}`;
    const { idempotencyKey: _k, ...payloadForHash } = dto;
    const requestHash = createHash('sha256').update(stableStringify(payloadForHash)).digest('hex');

    // 1. Claim the idempotency key (fails fast on concurrent duplicate).
    try {
      await this.idem.create({ key, requestHash, status: 'PENDING', expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_HOURS * 3600_000) });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        const existing = await this.idem.findOne({ key }).lean();
        if (!existing) throw err;
        if (existing.requestHash !== requestHash) {
          throw new DomainError(ErrorCodes.IDEMPOTENCY_MISMATCH, 'This idempotency key was already used with a different request payload');
        }
        if (existing.status === 'COMPLETED' && existing.saleId) {
          const sale = await this.sales.findById(existing.saleId).lean();
          if (sale) return { ...toSaleDto(sale), replayed: true };
        }
        throw new AppException(ErrorCodes.IDEMPOTENCY_IN_PROGRESS, 'A checkout with this key is still being processed. Retry shortly.', HttpStatus.CONFLICT);
      }
      throw err;
    }

    try {
      const sale = await this.tx.withTransaction(async (session) => this.commitSale(dto, actor, requestId, key, session));
      await this.idem.updateOne({ key }, { $set: { status: 'COMPLETED', saleId: sale._id } });
      return { ...toSaleDto(sale.toObject()), replayed: false };
    } catch (err) {
      // Release the key so the client can retry after fixing the problem.
      await this.idem.deleteOne({ key, status: 'PENDING' }).catch(() => undefined);
      throw err;
    }
  }

  private async commitSale(dto: CheckoutDto, actor: AuthUser, requestId: string, idempotencyKey: string, session: ClientSession): Promise<SaleDocument> {
    // 2. Cash session
    const cashSession = await this.cashSessions.requireOpen(actor.id, session);
    // 3-4. Re-price everything server-side
    const byId = await this.loadProducts(dto.lines, session);
    const policy = await this.policyFor(actor);
    const priced: PricedCart = priceCart(
      { lines: dto.lines.map((l) => ({ product: byId.get(l.productId)!, unitName: l.unitName, quantity: l.quantity, discountMinor: l.discountMinor, prescriptionVerified: l.prescriptionVerified })), orderDiscountMinor: dto.orderDiscountMinor },
      policy,
    );
    const settlement = settleTenders(priced.totalMinor, dto.tenders, Boolean(dto.customerId));
    if (settlement.creditMinor > 0 && !actor.permissions.includes('pos.credit')) {
      throw new DomainError(ErrorCodes.FORBIDDEN, 'You are not permitted to record credit sales');
    }

    // 5-7. Allocate FEFO per product (aggregate lines for the same product), then post movements.
    const saleId = new Types.ObjectId();
    const neededByProduct = new Map<string, number>();
    for (const l of priced.lines) neededByProduct.set(l.productId, (neededByProduct.get(l.productId) ?? 0) + l.quantityUnits);

    const allocationsByProduct = new Map<string, Allocation[]>();
    for (const [pid, qty] of neededByProduct) {
      const batches = await this.ledger.eligibleBatches(pid, session);
      const alloc = allocateFefo(batches as never, qty);
      if (!alloc) {
        const p = byId.get(pid)!;
        const available = batches.reduce((a, b) => a + b.onHandUnits - b.reservedUnits, 0);
        throw new DomainError(ErrorCodes.INSUFFICIENT_STOCK, `Insufficient sellable stock for ${p.brandName}: need ${qty} ${p.baseUnit}, have ${available}`, { productId: pid, requested: qty, available });
      }
      allocationsByProduct.set(pid, alloc);
    }

    // Distribute each product's allocations across its lines in order.
    const saleLines = priced.lines.map((l) => {
      const pool = allocationsByProduct.get(l.productId)!;
      let remaining = l.quantityUnits;
      const mine: Allocation[] = [];
      while (remaining > 0) {
        const head = pool[0];
        if (!head) throw new Error('allocation underflow'); // cannot happen: pool sums to needed
        const take = Math.min(head.quantityUnits, remaining);
        mine.push({ ...head, quantityUnits: take });
        head.quantityUnits -= take;
        if (head.quantityUnits === 0) pool.shift();
        remaining -= take;
      }
      const costBasis = mine.reduce((a, m) => a + m.quantityUnits * m.unitCostMinor, 0);
      return { ...l, allocations: mine, costBasisMinor: costBasis, returnedUnits: 0 };
    });

    // 8. Post ledger movements (conditional atomic updates — abort whole sale on any failure).
    for (const line of saleLines) {
      for (const a of line.allocations) {
        await this.ledger.postMovement(
          { batchId: a.batchId, type: 'SALE', quantityUnits: -a.quantityUnits, unitCostMinor: a.unitCostMinor, sourceType: 'Sale', sourceId: saleId, actorId: actor.id, requestId },
          session,
        );
      }
    }

    const invoiceNumber = await this.counters.nextNumber((await this.settings.get()).invoicePrefix || 'INV', session);
    const [sale] = await this.sales.create(
      [
        {
          _id: saleId,
          invoiceNumber,
          idempotencyKey,
          cashierId: new Types.ObjectId(actor.id),
          customerId: dto.customerId ? new Types.ObjectId(dto.customerId) : undefined,
          cashSessionId: cashSession._id,
          lines: saleLines.map((l) => ({
            productId: new Types.ObjectId(l.productId),
            sku: l.sku,
            name: l.name,
            unitName: l.unitName,
            unitMultiplier: l.unitMultiplier,
            quantity: l.quantity,
            quantityUnits: l.quantityUnits,
            unitPriceMinor: l.unitPriceMinor,
            discountMinor: l.discountMinor,
            taxRateBps: l.taxRateBps,
            taxMinor: l.taxMinor,
            lineTotalMinor: l.lineTotalMinor,
            costBasisMinor: l.costBasisMinor,
            allocations: l.allocations,
            returnedUnits: 0,
            prescriptionVerified: l.prescriptionVerified,
          })),
          subtotalMinor: priced.subtotalMinor,
          discountMinor: priced.discountMinor,
          taxMinor: priced.taxMinor,
          totalMinor: priced.totalMinor,
          costMinor: saleLines.reduce((a, l) => a + l.costBasisMinor, 0),
          paidMinor: settlement.paidMinor,
          changeMinor: settlement.changeMinor,
          paymentStatus: 'COMPLETED',
          status: 'COMPLETED',
          notes: dto.notes,
          requestId,
        },
      ],
      { session },
    );

    // Payments: cash is recorded net of change.
    const paymentDocs = dto.tenders
      .map((t) => ({ ...t, amountMinor: t.method === 'CASH' ? settlement.cashKeptMinor : t.amountMinor }))
      .filter((t) => t.amountMinor > 0)
      .map((t) => ({ saleId, method: t.method, amountMinor: t.amountMinor, status: 'COMPLETED', reference: t.reference, cashSessionId: cashSession._id, actorId: new Types.ObjectId(actor.id) }));
    if (paymentDocs.length) await this.payments.create(paymentDocs, { session });

    await this.cashSessions.recordCash(cashSession._id, 'SALE', settlement.cashKeptMinor, saleId, actor.id, session);

    if (settlement.creditMinor > 0) {
      await this.customersService.postLedger(
        { customerId: dto.customerId!, type: 'CREDIT_SALE', amountMinor: settlement.creditMinor, sourceType: 'Sale', sourceId: saleId, note: invoiceNumber, actorId: actor.id },
        session,
      );
    }

    await this.audit.record(
      { actorId: actor.id, actorName: actor.name, action: 'sale.checkout', entityType: 'Sale', entityId: saleId, after: { invoiceNumber, totalMinor: priced.totalMinor, lines: saleLines.length, tenders: dto.tenders.map((t) => t.method) }, requestId },
      session,
    );
    return sale;
  }

  // ---------- Held carts ----------
  async hold(dto: HoldCartDto, actor: AuthUser) {
    const doc = await this.held.create({ cashierId: new Types.ObjectId(actor.id), label: dto.label, payload: { lines: dto.lines, orderDiscountMinor: dto.orderDiscountMinor, customerId: dto.customerId } });
    return toHeldDto(doc.toObject());
  }
  async listHeld(actor: AuthUser) {
    const docs = await this.held.find({ cashierId: new Types.ObjectId(actor.id) }).sort({ createdAt: -1 }).limit(50).lean();
    return docs.map(toHeldDto);
  }
  async releaseHeld(id: string, actor: AuthUser) {
    const doc = await this.held.findOneAndDelete({ _id: new Types.ObjectId(id), cashierId: new Types.ObjectId(actor.id) }).lean();
    if (!doc) throw new NotFoundError('HeldCart', id);
    return toHeldDto(doc);
  }
}

function toHeldDto(d: Doc) {
  return { id: String(d._id), label: d.label, ...(d.payload as Record<string, unknown>), createdAt: d.createdAt };
}

/** Deterministic JSON for hashing: sorted keys, no undefined. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as object)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
