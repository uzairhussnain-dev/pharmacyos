import { Body, Controller, Get, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PaymentMethods, ReturnDispositions, type PaymentMethod, type ReturnDisposition } from '@pharmacy-os/shared-types';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsMongoId, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { AuthUser, CurrentUser, RequestId, RequirePermissions } from '../../common/decorators';
import { DomainError, ErrorCodes, NotFoundError } from '../../common/errors';
import { roundHalfUp } from '../../common/money/money';
import { PaginationQuery, escapeRegex, paginate } from '../../common/pagination';
import { TransactionService } from '../../database/database.module';
import { CounterService } from '../../database/schemas.module';
import { Batch, BatchDocument } from '../../database/schemas/batch.schema';
import { Payment, PaymentDocument, Sale, SaleDocument, SaleReturn, SaleReturnDocument } from '../../database/schemas/sales.schema';
import { AuditModule, AuditService } from '../audit/audit.module';
import { CashSessionsModule, CashSessionsService } from '../cash-sessions/cash-sessions.module';
import { CustomersModule, CustomersService } from '../customers/customers.module';
import { InventoryModule } from '../inventory/inventory.module';
import { StockLedgerService } from '../inventory/stock-ledger.service';
import { SettingsService } from '../settings/settings.module';
import { toReturnDto, toSaleDto } from './sales.mapper';

export class ReturnLineDto {
  @IsInt() @Min(0) lineIndex: number;
  @IsInt() @Min(1) quantityUnits: number;
  @IsIn(ReturnDispositions) disposition: ReturnDisposition;
}
export class CreateReturnDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ReturnLineDto) lines: ReturnLineDto[];
  @IsString() @MinLength(3) @MaxLength(300) reason: string;
  @IsIn(PaymentMethods) refundMethod: PaymentMethod;
}
export class RejectReturnDto {
  @IsString() @MinLength(3) @MaxLength(300) reason: string;
}
class SalesQuery extends PaginationQuery {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsMongoId() cashierId?: string;
  @IsOptional() @IsMongoId() customerId?: string;
  @IsOptional() @IsString() status?: string;
}
class ReturnsQuery extends PaginationQuery {
  @IsOptional() @IsString() status?: string;
}

@Injectable()
export class SalesService {
  constructor(
    @InjectModel(Sale.name) private readonly sales: Model<SaleDocument>,
    @InjectModel(Payment.name) private readonly payments: Model<PaymentDocument>,
    @InjectModel(SaleReturn.name) private readonly returns: Model<SaleReturnDocument>,
    @InjectModel(Batch.name) private readonly batches: Model<BatchDocument>,
    private readonly ledger: StockLedgerService,
    private readonly cashSessions: CashSessionsService,
    private readonly customers: CustomersService,
    private readonly settings: SettingsService,
    private readonly counters: CounterService,
    private readonly tx: TransactionService,
    private readonly audit: AuditService,
  ) {}

  async list(query: SalesQuery, actor: AuthUser) {
    const filter: FilterQuery<SaleDocument> = {};
    if (query.q) filter.invoiceNumber = new RegExp(escapeRegex(query.q), 'i');
    if (query.status) filter.status = query.status;
    if (query.customerId) filter.customerId = new Types.ObjectId(query.customerId);
    if (!actor.permissions.includes('reports.read')) filter.cashierId = new Types.ObjectId(actor.id);
    else if (query.cashierId) filter.cashierId = new Types.ObjectId(query.cashierId);
    if (query.from || query.to) {
      filter.createdAt = {};
      if (query.from) filter.createdAt.$gte = new Date(query.from);
      if (query.to) filter.createdAt.$lte = new Date(query.to);
    }
    const [items, total] = await Promise.all([
      this.sales.find(filter).sort({ createdAt: -1 }).skip(query.skip).limit(query.pageSize).populate('cashierId', 'name').populate('customerId', 'name').lean(),
      this.sales.countDocuments(filter),
    ]);
    return paginate(items.map((s) => toSaleDto(s)), total, query);
  }

  async get(id: string) {
    const filter = Types.ObjectId.isValid(id) ? { _id: new Types.ObjectId(id) } : { invoiceNumber: id.toUpperCase() };
    const s = await this.sales.findOne(filter).populate('cashierId', 'name').populate('customerId', 'name phone').lean();
    if (!s) throw new NotFoundError('Sale', id);
    const [payments, returns] = await Promise.all([
      this.payments.find({ saleId: s._id }).sort({ createdAt: 1 }).lean(),
      this.returns.find({ saleId: s._id }).sort({ createdAt: -1 }).populate('requestedById approvedById', 'name').lean(),
    ]);
    return { ...toSaleDto(s, payments), returns: returns.map(toReturnDto) };
  }

  /** Receipt payload: sale + pharmacy profile. Reprinting is a read — never creates a sale. */
  async receipt(id: string) {
    const sale = await this.get(id);
    const settings = await this.settings.get();
    return { sale, pharmacy: { name: settings.pharmacyName, addressLine: settings.addressLine, phone: settings.phone, licenseNumber: settings.licenseNumber, footer: settings.receiptFooter, currency: settings.currency } };
  }

  async createReturn(saleId: string, dto: CreateReturnDto, actor: AuthUser, requestId: string) {
    const sale = await this.sales.findById(saleId).lean();
    if (!sale) throw new NotFoundError('Sale', saleId);
    if (sale.status === 'VOIDED') throw new DomainError(ErrorCodes.INVALID_STATE_TRANSITION, 'Sale is voided');
    const settings = await this.settings.get();
    const ageDays = (Date.now() - sale.createdAt.getTime()) / 86400_000;
    if (settings.returnWindowDays > 0 && ageDays > settings.returnWindowDays && !actor.permissions.includes('sales.return.approve')) {
      throw new DomainError(ErrorCodes.INVALID_STATE_TRANSITION, `Return window of ${settings.returnWindowDays} days has passed`);
    }
    // Pending returns on this sale also consume returnable quantity
    const pending = await this.returns.find({ saleId: sale._id, status: 'PENDING_APPROVAL' }).lean();
    const pendingByLine = new Map<number, number>();
    for (const r of pending) for (const l of r.lines) pendingByLine.set(l.lineIndex, (pendingByLine.get(l.lineIndex) ?? 0) + l.quantityUnits);

    const lines = dto.lines.map((rl) => {
      const line = sale.lines[rl.lineIndex];
      if (!line) throw new DomainError(ErrorCodes.VALIDATION_FAILED, `Line ${rl.lineIndex} does not exist`);
      const returnable = line.quantityUnits - line.returnedUnits - (pendingByLine.get(rl.lineIndex) ?? 0);
      if (rl.quantityUnits > returnable) {
        throw new DomainError(ErrorCodes.RETURN_EXCEEDS_SOLD, `Only ${returnable} ${line.unitName === 'Tablet' ? 'units' : 'base units'} of ${line.name} can be returned`, { lineIndex: rl.lineIndex, returnable });
      }
      // Refund is proportional to the line's net+tax; cost basis proportional to allocation cost.
      const refund = roundHalfUp((line.lineTotalMinor * rl.quantityUnits) / line.quantityUnits);
      const cost = roundHalfUp((line.costBasisMinor * rl.quantityUnits) / line.quantityUnits);
      // Returned units post back to the first allocation batch (most-recent FEFO pick). Disposition decides sellability.
      const batchId = line.allocations[0].batchId;
      return { lineIndex: rl.lineIndex, productId: line.productId, name: line.name, quantityUnits: rl.quantityUnits, disposition: rl.disposition, batchId, refundMinor: refund, costBasisMinor: cost };
    });
    const refundTotal = lines.reduce((a, l) => a + l.refundMinor, 0);
    const alreadyRefunded = -(await this.payments.aggregate<{ total: number }>([{ $match: { saleId: sale._id, amountMinor: { $lt: 0 } } }, { $group: { _id: null, total: { $sum: '$amountMinor' } } }]))[0]?.total || 0;
    if (refundTotal + alreadyRefunded > sale.paidMinor) {
      throw new DomainError(ErrorCodes.REFUND_EXCEEDS_PAID, 'Refund would exceed the amount paid on this sale');
    }

    const ret = await this.returns.create({
      returnNumber: await this.counters.nextNumber('RET'),
      saleId: sale._id,
      lines,
      refundMinor: refundTotal,
      refundMethod: dto.refundMethod,
      reason: dto.reason,
      status: 'PENDING_APPROVAL',
      requestedById: new Types.ObjectId(actor.id),
    });
    await this.audit.record({ actorId: actor.id, actorName: actor.name, action: 'sale_return.request', entityType: 'SaleReturn', entityId: ret._id, after: { saleId: sale._id.toString(), refundMinor: refundTotal, lines: lines.length }, reason: dto.reason, requestId });

    // Self-approval allowed only for users with the approve permission (pharmacist/manager/owner).
    if (actor.permissions.includes('sales.return.approve')) {
      return this.approveReturn(sale._id.toString(), ret._id.toString(), actor, requestId);
    }
    return toReturnDto(ret.toObject());
  }

  /** Approval posts stock back (RESTOCK → ACTIVE batch; QUARANTINE → quarantined; WRITE_OFF → no stock), records refund payment and cash movement. */
  async approveReturn(saleId: string, returnId: string, actor: AuthUser, requestId: string) {
    return this.tx.withTransaction(async (session) => {
      const ret = await this.returns.findById(returnId).session(session);
      if (!ret || ret.saleId.toString() !== saleId) throw new NotFoundError('SaleReturn', returnId);
      if (ret.status !== 'PENDING_APPROVAL') throw new DomainError(ErrorCodes.INVALID_STATE_TRANSITION, `Return is ${ret.status}`);
      const sale = await this.sales.findById(ret.saleId).session(session);
      if (!sale) throw new NotFoundError('Sale', saleId);

      for (const l of ret.lines) {
        const line = sale.lines[l.lineIndex];
        if (line.quantityUnits - line.returnedUnits < l.quantityUnits) {
          throw new DomainError(ErrorCodes.RETURN_EXCEEDS_SOLD, `Line ${l.lineIndex} no longer has enough returnable units`);
        }
        line.returnedUnits += l.quantityUnits;
        if (l.disposition === 'WRITE_OFF') continue; // no stock re-enters inventory
        await this.restock(l.batchId, l.quantityUnits, l.disposition, ret, actor, requestId, session);
      }

      // Refund payment (negative amount), linked to the original payment of the same method where possible.
      const original = await this.payments.findOne({ saleId: sale._id, method: ret.refundMethod, amountMinor: { $gt: 0 } }).session(session).lean();
      if (ret.refundMinor > 0) {
        await this.payments.create(
          [{ saleId: sale._id, method: ret.refundMethod, amountMinor: -ret.refundMinor, status: 'COMPLETED', refundOfPaymentId: original?._id, saleReturnId: ret._id, cashSessionId: undefined, actorId: new Types.ObjectId(actor.id) }],
          { session },
        );
        if (ret.refundMethod === 'CASH') {
          const cs = await this.cashSessions.requireOpen(actor.id, session);
          await this.cashSessions.recordCash(cs._id, 'REFUND', ret.refundMinor, ret._id, actor.id, session);
          await this.payments.updateOne({ saleReturnId: ret._id }, { $set: { cashSessionId: cs._id } }, { session });
        } else if (ret.refundMethod === 'CREDIT' && sale.customerId) {
          await this.customers.postLedger({ customerId: sale.customerId, type: 'REFUND', amountMinor: -ret.refundMinor, sourceType: 'SaleReturn', sourceId: ret._id, note: ret.returnNumber, actorId: actor.id }, session);
        }
      }

      const allReturned = sale.lines.every((l) => l.returnedUnits >= l.quantityUnits);
      sale.status = allReturned ? 'RETURNED' : 'PARTIALLY_RETURNED';
      const refunded = -(await this.payments.aggregate<{ total: number }>([{ $match: { saleId: sale._id, amountMinor: { $lt: 0 } } }, { $group: { _id: null, total: { $sum: '$amountMinor' } } }]).session(session))[0]?.total || 0;
      sale.paymentStatus = refunded >= sale.paidMinor ? 'REFUNDED' : refunded > 0 ? 'PARTIALLY_REFUNDED' : sale.paymentStatus;
      await sale.save({ session });

      ret.status = 'APPROVED';
      ret.approvedById = new Types.ObjectId(actor.id);
      ret.approvedAt = new Date();
      await ret.save({ session });
      await this.audit.record({ actorId: actor.id, actorName: actor.name, action: 'sale_return.approve', entityType: 'SaleReturn', entityId: ret._id, after: { refundMinor: ret.refundMinor, saleStatus: sale.status }, requestId }, session);
      return toReturnDto(ret.toObject());
    });
  }

  private async restock(batchId: Types.ObjectId, qty: number, disposition: ReturnDisposition, ret: SaleReturnDocument, actor: AuthUser, requestId: string, session: ClientSession): Promise<void> {
    const batch = await this.batches.findById(batchId).session(session);
    if (!batch) throw new NotFoundError('Batch', batchId.toString());
    if (disposition === 'QUARANTINE') {
      // Quarantined returns go to a dedicated quarantine batch so the sellable batch stays clean.
      const qBatchNumber = `${batch.batchNumber}-RET`;
      let q = await this.batches.findOne({ productId: batch.productId, batchNumber: qBatchNumber, status: 'QUARANTINED', expiryDate: batch.expiryDate }).session(session);
      if (!q) {
        [q] = await this.batches.create(
          [{ productId: batch.productId, batchNumber: qBatchNumber, expiryDate: batch.expiryDate, expiryPrecision: batch.expiryPrecision, purchaseCostMinor: batch.purchaseCostMinor, landedUnitCostMinor: batch.landedUnitCostMinor, receivedUnits: 0, onHandUnits: 0, reservedUnits: 0, status: 'QUARANTINED', statusReason: 'Customer returns pending pharmacist review', supplierId: batch.supplierId, receivedAt: new Date(), createdById: new Types.ObjectId(actor.id) }],
          { session },
        );
      }
      await this.ledger.postMovement({ batchId: q._id, type: 'SALE_RETURN', quantityUnits: qty, unitCostMinor: batch.landedUnitCostMinor, sourceType: 'SaleReturn', sourceId: ret._id, reason: ret.reason, actorId: actor.id, requestId, allowIneligible: true }, session);
      return;
    }
    // RESTOCK: only into a still-sellable batch; otherwise fall back to quarantine.
    const sellable = batch.status === 'ACTIVE' && batch.expiryDate.getTime() > Date.now();
    if (!sellable) return this.restock(batchId, qty, 'QUARANTINE', ret, actor, requestId, session);
    await this.ledger.postMovement({ batchId: batch._id, type: 'SALE_RETURN', quantityUnits: qty, unitCostMinor: batch.landedUnitCostMinor, sourceType: 'SaleReturn', sourceId: ret._id, reason: ret.reason, actorId: actor.id, requestId }, session);
  }

  async rejectReturn(saleId: string, returnId: string, dto: RejectReturnDto, actor: AuthUser, requestId: string) {
    const ret = await this.returns.findById(returnId);
    if (!ret || ret.saleId.toString() !== saleId) throw new NotFoundError('SaleReturn', returnId);
    if (ret.status !== 'PENDING_APPROVAL') throw new DomainError(ErrorCodes.INVALID_STATE_TRANSITION, `Return is ${ret.status}`);
    ret.status = 'REJECTED';
    ret.rejectionReason = dto.reason;
    await ret.save();
    await this.audit.record({ actorId: actor.id, actorName: actor.name, action: 'sale_return.reject', entityType: 'SaleReturn', entityId: ret._id, reason: dto.reason, requestId });
    return toReturnDto(ret.toObject());
  }

  async listReturns(query: ReturnsQuery) {
    const filter: FilterQuery<SaleReturnDocument> = {};
    if (query.status) filter.status = query.status;
    const [items, total] = await Promise.all([
      this.returns.find(filter).sort({ createdAt: -1 }).skip(query.skip).limit(query.pageSize).populate('saleId', 'invoiceNumber').populate('requestedById approvedById', 'name').lean(),
      this.returns.countDocuments(filter),
    ]);
    return paginate(items.map(toReturnDto), total, query);
  }
}

@ApiTags('sales')
@ApiBearerAuth()
@Controller()
export class SalesController {
  constructor(private readonly service: SalesService) {}

  @Get('sales') @RequirePermissions('sales.read') list(@Query() q: SalesQuery, @CurrentUser() a: AuthUser) {
    return this.service.list(q, a);
  }
  @Get('sales/returns') @RequirePermissions('sales.read') listReturns(@Query() q: ReturnsQuery) {
    return this.service.listReturns(q);
  }
  @Get('sales/:id') @RequirePermissions('sales.read') get(@Param('id') id: string) {
    return this.service.get(id);
  }
  @Get('sales/:id/receipt') @RequirePermissions('sales.read') receipt(@Param('id') id: string) {
    return this.service.receipt(id);
  }
  @Post('sales/:id/returns') @RequirePermissions('sales.return') createReturn(@Param('id') id: string, @Body() dto: CreateReturnDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.createReturn(id, dto, a, r);
  }
  @Post('sales/:id/returns/:returnId/approve') @RequirePermissions('sales.return.approve') approve(@Param('id') id: string, @Param('returnId') rid: string, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.approveReturn(id, rid, a, r);
  }
  @Post('sales/:id/returns/:returnId/reject') @RequirePermissions('sales.return.approve') reject(@Param('id') id: string, @Param('returnId') rid: string, @Body() dto: RejectReturnDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.rejectReturn(id, rid, dto, a, r);
  }
}

@Module({
  imports: [InventoryModule, CashSessionsModule, CustomersModule, AuditModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
