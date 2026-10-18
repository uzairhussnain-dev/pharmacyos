import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags, PartialType } from '@nestjs/swagger';
import { PaymentMethods, type PaymentMethod } from '@pharmacy-os/shared-types';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { AuthUser, CurrentUser, RequestId, RequirePermissions } from '../../common/decorators';
import { DomainError, ErrorCodes, NotFoundError } from '../../common/errors';
import { PaginationQuery, escapeRegex, paginate } from '../../common/pagination';
import { TransactionService } from '../../database/database.module';
import { Customer, CustomerDocument, CustomerLedgerEntry, CustomerLedgerEntryDocument } from '../../database/schemas/finance.schema';
import { AuditService } from '../audit/audit.module';

export class CreateCustomerDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @IsOptional() @IsBoolean() consentToContact?: boolean;
  @IsOptional() @IsBoolean() creditEnabled?: boolean;
  @IsOptional() @IsInt() @Min(0) creditLimitMinor?: number;
}
export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class CustomerPaymentDto {
  @IsInt() @Min(1) amountMinor: number;
  @IsIn(PaymentMethods) method: PaymentMethod;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
}

export function toCustomerDto(c: Customer & { _id: Types.ObjectId }) {
  return { ...c, id: c._id.toString(), _id: undefined, __v: undefined };
}

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @InjectModel(CustomerLedgerEntry.name) private readonly ledger: Model<CustomerLedgerEntryDocument>,
    private readonly tx: TransactionService,
    private readonly audit: AuditService,
  ) {}

  async list(query: PaginationQuery) {
    const filter: FilterQuery<CustomerDocument> = {};
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ name: rx }, { phone: rx }];
    }
    const [items, total] = await Promise.all([
      this.customers.find(filter).sort({ name: 1 }).skip(query.skip).limit(query.pageSize).lean(),
      this.customers.countDocuments(filter),
    ]);
    return paginate(items.map(toCustomerDto), total, query);
  }

  async get(id: string) {
    const c = await this.customers.findById(id).lean();
    if (!c) throw new NotFoundError('Customer', id);
    const entries = await this.ledger.find({ customerId: c._id }).sort({ createdAt: -1 }).limit(50).populate('actorId', 'name').lean();
    return { ...toCustomerDto(c), ledger: entries.map((e) => ({ ...e, id: e._id.toString(), actorName: (e.actorId as unknown as { name?: string })?.name })) };
  }

  async create(dto: CreateCustomerDto, actor: AuthUser, requestId: string) {
    const c = await this.customers.create(dto);
    await this.audit.record({ actorId: actor.id, actorName: actor.name, action: 'customer.create', entityType: 'Customer', entityId: c._id, after: { name: c.name, creditEnabled: c.creditEnabled }, requestId });
    return toCustomerDto(c.toObject());
  }

  async update(id: string, dto: UpdateCustomerDto, actor: AuthUser, requestId: string) {
    const c = await this.customers.findByIdAndUpdate(id, { $set: dto }, { new: true }).lean();
    if (!c) throw new NotFoundError('Customer', id);
    await this.audit.record({ actorId: actor.id, actorName: actor.name, action: 'customer.update', entityType: 'Customer', entityId: id, after: { ...dto }, requestId });
    return toCustomerDto(c);
  }

  /**
   * Posts a ledger entry and atomically moves the balance. For CREDIT_SALE the update is conditional on
   * the credit limit so two concurrent credit sales cannot both exceed it.
   */
  async postLedger(
    input: { customerId: Types.ObjectId | string; type: CustomerLedgerEntry['type']; amountMinor: number; sourceType: string; sourceId?: Types.ObjectId; note?: string; actorId: string },
    session: ClientSession,
  ) {
    const filter: FilterQuery<CustomerDocument> = { _id: new Types.ObjectId(input.customerId), isActive: true };
    if (input.type === 'CREDIT_SALE') {
      filter.creditEnabled = true;
      filter.$expr = { $lte: [{ $add: ['$balanceMinor', input.amountMinor] }, '$creditLimitMinor'] };
    }
    const updated = await this.customers.findOneAndUpdate(filter, { $inc: { balanceMinor: input.amountMinor } }, { new: true, session });
    if (!updated) {
      const c = await this.customers.findById(input.customerId).session(session).lean();
      if (!c) throw new NotFoundError('Customer', String(input.customerId));
      if (!c.creditEnabled) throw new DomainError(ErrorCodes.CREDIT_LIMIT_EXCEEDED, `${c.name} does not have a credit account`);
      throw new DomainError(ErrorCodes.CREDIT_LIMIT_EXCEEDED, `Credit limit exceeded for ${c.name}`, {
        balanceMinor: c.balanceMinor,
        creditLimitMinor: c.creditLimitMinor,
        requestedMinor: input.amountMinor,
      });
    }
    const [entry] = await this.ledger.create(
      [{ ...input, customerId: updated._id, actorId: new Types.ObjectId(input.actorId), balanceAfterMinor: updated.balanceMinor }],
      { session },
    );
    return entry;
  }

  async recordPayment(id: string, dto: CustomerPaymentDto, actor: AuthUser, requestId: string) {
    return this.tx.withTransaction(async (session) => {
      const entry = await this.postLedger(
        { customerId: id, type: 'PAYMENT', amountMinor: -dto.amountMinor, sourceType: 'CustomerPayment', note: dto.reference, actorId: actor.id },
        session,
      );
      await this.audit.record({ actorId: actor.id, actorName: actor.name, action: 'customer.payment', entityType: 'Customer', entityId: id, after: { amountMinor: dto.amountMinor, method: dto.method }, requestId }, session);
      return { id: entry._id.toString(), balanceAfterMinor: entry.balanceAfterMinor };
    });
  }
}

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly service: CustomersService) {}
  @Get() @RequirePermissions('customers.read') list(@Query() q: PaginationQuery) {
    return this.service.list(q);
  }
  @Get(':id') @RequirePermissions('customers.read') get(@Param('id') id: string) {
    return this.service.get(id);
  }
  @Post() @RequirePermissions('customers.write') create(@Body() dto: CreateCustomerDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.create(dto, a, r);
  }
  @Patch(':id') @RequirePermissions('customers.write') update(@Param('id') id: string, @Body() dto: UpdateCustomerDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.update(id, dto, a, r);
  }
  @Post(':id/payments') @RequirePermissions('finance.read', 'customers.write') pay(@Param('id') id: string, @Body() dto: CustomerPaymentDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.recordPayment(id, dto, a, r);
  }
}

@Module({ controllers: [CustomersController], providers: [CustomersService], exports: [CustomersService] })
export class CustomersModule {}
