import { Doc } from '../../common/types';
import { Body, Controller, Get, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ExpenseCategories, PaymentMethods, type ExpenseCategory, type PaymentMethod } from '@pharmacy-os/shared-types';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { FilterQuery, Model, Types } from 'mongoose';
import { AuthUser, CurrentUser, RequestId, RequirePermissions } from '../../common/decorators';
import { DomainError, ErrorCodes, NotFoundError } from '../../common/errors';
import { PaginationQuery, paginate } from '../../common/pagination';
import { CashSession, CashSessionDocument, Expense, ExpenseDocument } from '../../database/schemas/finance.schema';
import { AuditService } from '../audit/audit.module';

export class CreateExpenseDto {
  @IsIn(ExpenseCategories) category: ExpenseCategory;
  @IsInt() @Min(1) amountMinor: number;
  @IsDateString() date: string;
  @IsIn(PaymentMethods) paymentMethod: PaymentMethod;
  @IsString() @MinLength(3) @MaxLength(300) description: string;
}
class ExpenseQuery extends PaginationQuery {
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

@Injectable()
export class ExpensesService {
  constructor(
    @InjectModel(Expense.name) private readonly expenses: Model<ExpenseDocument>,
    @InjectModel(CashSession.name) private readonly sessions: Model<CashSessionDocument>,
    private readonly audit: AuditService,
  ) {}

  async list(query: ExpenseQuery) {
    const filter: FilterQuery<ExpenseDocument> = {};
    if (query.category) filter.category = query.category;
    if (query.from || query.to) {
      filter.date = {};
      if (query.from) filter.date.$gte = new Date(query.from);
      if (query.to) filter.date.$lte = new Date(query.to);
    }
    const [items, total, agg] = await Promise.all([
      this.expenses.find(filter).sort({ date: -1 }).skip(query.skip).limit(query.pageSize).populate('createdById approvedById', 'name').lean(),
      this.expenses.countDocuments(filter),
      this.expenses.aggregate<{ _id: string; total: number }>([{ $match: filter }, { $group: { _id: '$category', total: { $sum: '$amountMinor' } } }]),
    ]);
    return { ...paginate(items.map(toExpenseDto), total, query), byCategory: agg.map((a) => ({ category: a._id, totalMinor: a.total })), totalMinor: agg.reduce((a, b) => a + b.total, 0) };
  }

  async create(dto: CreateExpenseDto, actor: AuthUser, requestId: string) {
    // Cash expenses paid from the drawer are linked to the actor's open session (if any) so reconciliation sees them.
    let cashSessionId: Types.ObjectId | undefined;
    if (dto.paymentMethod === 'CASH') {
      const open = await this.sessions.findOneAndUpdate(
        { cashierId: new Types.ObjectId(actor.id), status: 'OPEN' },
        { $inc: { cashOutMinor: dto.amountMinor }, $push: { movements: { _id: new Types.ObjectId(), type: 'CASH_OUT', amountMinor: -dto.amountMinor, reason: `Expense: ${dto.description}`, actorId: new Types.ObjectId(actor.id), createdAt: new Date() } } },
        { new: true },
      );
      cashSessionId = open?._id;
    }
    const autoApprove = actor.permissions.includes('finance.read');
    const e = await this.expenses.create({ ...dto, date: new Date(dto.date), createdById: new Types.ObjectId(actor.id), approvedById: autoApprove ? new Types.ObjectId(actor.id) : undefined, approvedAt: autoApprove ? new Date() : undefined, cashSessionId });
    await this.audit.record({ actorId: actor.id, actorName: actor.name, action: 'expense.create', entityType: 'Expense', entityId: e._id, after: { category: e.category, amountMinor: e.amountMinor, paymentMethod: e.paymentMethod }, requestId });
    return toExpenseDto(e.toObject());
  }

  async approve(id: string, actor: AuthUser, requestId: string) {
    const e = await this.expenses.findById(id);
    if (!e) throw new NotFoundError('Expense', id);
    if (e.approvedAt) throw new DomainError(ErrorCodes.INVALID_STATE_TRANSITION, 'Already approved');
    e.approvedById = new Types.ObjectId(actor.id);
    e.approvedAt = new Date();
    await e.save();
    await this.audit.record({ actorId: actor.id, actorName: actor.name, action: 'expense.approve', entityType: 'Expense', entityId: e._id, requestId });
    return toExpenseDto(e.toObject());
  }
}

function toExpenseDto(e: Doc) {
  const nameOf = (v: unknown) => (v && typeof v === 'object' && 'name' in (v as object) ? (v as { name: string }).name : undefined);
  return { id: String(e._id), category: e.category, amountMinor: e.amountMinor, date: e.date, paymentMethod: e.paymentMethod, description: e.description, createdByName: nameOf(e.createdById), approvedByName: nameOf(e.approvedById), approvedAt: e.approvedAt, createdAt: e.createdAt };
}

@ApiTags('expenses')
@ApiBearerAuth()
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly service: ExpensesService) {}
  @Get() @RequirePermissions('expenses.read') list(@Query() q: ExpenseQuery) {
    return this.service.list(q);
  }
  @Post() @RequirePermissions('expenses.write') create(@Body() dto: CreateExpenseDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.create(dto, a, r);
  }
  @Post(':id/approve') @RequirePermissions('finance.read') approve(@Param('id') id: string, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.approve(id, a, r);
  }
}

@Module({ controllers: [ExpensesController], providers: [ExpensesService] })
export class ExpensesModule {}
