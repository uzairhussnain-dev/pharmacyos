import { Doc } from '../../common/types';
import { Body, Controller, Get, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { AuthUser, CurrentUser, RequestId, RequirePermissions } from '../../common/decorators';
import { DomainError, ErrorCodes, NotFoundError } from '../../common/errors';
import { PaginationQuery, paginate } from '../../common/pagination';
import { TransactionService } from '../../database/database.module';
import { CashSession, CashSessionDocument } from '../../database/schemas/finance.schema';
import { AuditService } from '../audit/audit.module';

export class OpenSessionDto {
  @IsInt() @Min(0) openingFloatMinor: number;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}
export class CashMovementDto {
  @IsIn(['CASH_IN', 'CASH_OUT']) type: 'CASH_IN' | 'CASH_OUT';
  @IsInt() @Min(1) amountMinor: number;
  @IsString() @MinLength(3) @MaxLength(300) reason: string;
}
export class CloseSessionDto {
  @IsInt() @Min(0) countedClosingMinor: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
export class ReconcileDto {
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
class SessionQuery extends PaginationQuery {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() cashierId?: string;
}

export function expectedClosing(s: Pick<CashSession, 'openingFloatMinor' | 'cashSalesMinor' | 'cashRefundsMinor' | 'cashInMinor' | 'cashOutMinor'>): number {
  return s.openingFloatMinor + s.cashSalesMinor - s.cashRefundsMinor + s.cashInMinor - s.cashOutMinor;
}

export function toSessionDto(s: Doc) {
  const cashier = s.cashierId as { _id?: Types.ObjectId; name?: string } | Types.ObjectId;
  const base = s as unknown as CashSession;
  return {
    id: String(s._id),
    cashierId: cashier && typeof cashier === 'object' && '_id' in cashier ? String(cashier._id) : String(cashier),
    cashierName: (cashier as { name?: string })?.name,
    openingFloatMinor: base.openingFloatMinor,
    cashSalesMinor: base.cashSalesMinor,
    cashRefundsMinor: base.cashRefundsMinor,
    cashInMinor: base.cashInMinor,
    cashOutMinor: base.cashOutMinor,
    expectedClosingMinor: base.expectedClosingMinor ?? expectedClosing(base),
    countedClosingMinor: base.countedClosingMinor,
    varianceMinor: base.varianceMinor,
    status: base.status,
    movements: (base.movements ?? []).map((m) => ({ ...m, id: String(m._id), actorId: String(m.actorId), sourceId: m.sourceId ? String(m.sourceId) : undefined, _id: undefined })),
    openedAt: base.openedAt,
    closedAt: base.closedAt,
    reconciledAt: base.reconciledAt,
    notes: base.notes,
  };
}

@Injectable()
export class CashSessionsService {
  constructor(
    @InjectModel(CashSession.name) private readonly sessions: Model<CashSessionDocument>,
    private readonly tx: TransactionService,
    private readonly audit: AuditService,
  ) {}

  async current(cashierId: string) {
    const s = await this.sessions.findOne({ cashierId: new Types.ObjectId(cashierId), status: 'OPEN' }).lean();
    return s ? toSessionDto(s) : null;
  }

  /** Used by checkout inside its transaction. Throws when no open session. */
  async requireOpen(cashierId: string, session: ClientSession): Promise<CashSessionDocument> {
    const s = await this.sessions.findOne({ cashierId: new Types.ObjectId(cashierId), status: 'OPEN' }).session(session);
    if (!s) throw new DomainError(ErrorCodes.NO_OPEN_CASH_SESSION, 'Open a cash session before selling');
    return s;
  }

  /** Records a sale/refund cash movement on the session atomically (only while OPEN). */
  async recordCash(sessionId: Types.ObjectId, type: 'SALE' | 'REFUND', amountMinor: number, sourceId: Types.ObjectId, actorId: string, session: ClientSession) {
    if (amountMinor <= 0) return;
    const inc = type === 'SALE' ? { cashSalesMinor: amountMinor } : { cashRefundsMinor: amountMinor };
    const res = await this.sessions.updateOne(
      { _id: sessionId, status: 'OPEN' },
      { $inc: inc, $push: { movements: { _id: new Types.ObjectId(), type, amountMinor: type === 'SALE' ? amountMinor : -amountMinor, sourceId, actorId: new Types.ObjectId(actorId), createdAt: new Date() } } },
      { session },
    );
    if (res.matchedCount === 0) throw new DomainError(ErrorCodes.NO_OPEN_CASH_SESSION, 'Cash session is no longer open');
  }

  async open(dto: OpenSessionDto, actor: AuthUser, requestId: string) {
    const existing = await this.sessions.findOne({ cashierId: new Types.ObjectId(actor.id), status: 'OPEN' }).lean();
    if (existing) throw new DomainError(ErrorCodes.CASH_SESSION_ALREADY_OPEN, 'You already have an open cash session', { sessionId: existing._id.toString() });
    const s = await this.sessions.create({ cashierId: new Types.ObjectId(actor.id), openingFloatMinor: dto.openingFloatMinor, notes: dto.notes, status: 'OPEN', openedAt: new Date() });
    await this.audit.record({ actorId: actor.id, actorName: actor.name, action: 'cash_session.open', entityType: 'CashSession', entityId: s._id, after: { openingFloatMinor: dto.openingFloatMinor }, requestId });
    return toSessionDto(s.toObject());
  }

  async addMovement(id: string, dto: CashMovementDto, actor: AuthUser, requestId: string) {
    const signed = dto.type === 'CASH_IN' ? dto.amountMinor : -dto.amountMinor;
    const inc = dto.type === 'CASH_IN' ? { cashInMinor: dto.amountMinor } : { cashOutMinor: dto.amountMinor };
    const s = await this.sessions.findOneAndUpdate(
      { _id: new Types.ObjectId(id), status: 'OPEN', $or: [{ cashierId: new Types.ObjectId(actor.id) }, ...(actor.permissions.includes('cash.reconcile') ? [{}] : [])] },
      { $inc: inc, $push: { movements: { _id: new Types.ObjectId(), type: dto.type, amountMinor: signed, reason: dto.reason, actorId: new Types.ObjectId(actor.id), createdAt: new Date() } } },
      { new: true },
    ).lean();
    if (!s) throw new DomainError(ErrorCodes.NO_OPEN_CASH_SESSION, 'Session not found, not open, or not yours');
    await this.audit.record({ actorId: actor.id, actorName: actor.name, action: `cash_session.${dto.type.toLowerCase()}`, entityType: 'CashSession', entityId: id, after: { amountMinor: signed }, reason: dto.reason, requestId });
    return toSessionDto(s);
  }

  async close(id: string, dto: CloseSessionDto, actor: AuthUser, requestId: string) {
    return this.tx.withTransaction(async (session) => {
      const s = await this.sessions.findById(id).session(session);
      if (!s) throw new NotFoundError('CashSession', id);
      if (s.status !== 'OPEN') throw new DomainError(ErrorCodes.INVALID_STATE_TRANSITION, `Session is ${s.status}`);
      if (s.cashierId.toString() !== actor.id && !actor.permissions.includes('cash.reconcile')) {
        throw new DomainError(ErrorCodes.FORBIDDEN, 'Only the cashier or a manager can close this session');
      }
      s.expectedClosingMinor = expectedClosing(s);
      s.countedClosingMinor = dto.countedClosingMinor;
      s.varianceMinor = dto.countedClosingMinor - s.expectedClosingMinor;
      s.status = 'CLOSED';
      s.closedAt = new Date();
      if (dto.notes) s.notes = [s.notes, dto.notes].filter(Boolean).join('\n');
      await s.save({ session });
      await this.audit.record({ actorId: actor.id, actorName: actor.name, action: 'cash_session.close', entityType: 'CashSession', entityId: s._id, after: { expectedClosingMinor: s.expectedClosingMinor, countedClosingMinor: s.countedClosingMinor, varianceMinor: s.varianceMinor }, requestId }, session);
      return toSessionDto(s.toObject());
    });
  }

  async reconcile(id: string, dto: ReconcileDto, actor: AuthUser, requestId: string) {
    const s = await this.sessions.findById(id);
    if (!s) throw new NotFoundError('CashSession', id);
    if (s.status !== 'CLOSED') throw new DomainError(ErrorCodes.INVALID_STATE_TRANSITION, `Session is ${s.status}`);
    if (s.cashierId.toString() === actor.id && actor.role !== 'OWNER') {
      throw new DomainError(ErrorCodes.FORBIDDEN, 'A session must be reconciled by someone other than its cashier');
    }
    s.status = 'RECONCILED';
    s.reconciledAt = new Date();
    s.reconciledById = new Types.ObjectId(actor.id);
    if (dto.notes) s.notes = [s.notes, `Reconciled: ${dto.notes}`].filter(Boolean).join('\n');
    await s.save();
    await this.audit.record({ actorId: actor.id, actorName: actor.name, action: 'cash_session.reconcile', entityType: 'CashSession', entityId: s._id, after: { varianceMinor: s.varianceMinor }, reason: dto.notes, requestId });
    return toSessionDto(s.toObject());
  }

  async list(query: SessionQuery, actor: AuthUser) {
    const filter: FilterQuery<CashSessionDocument> = {};
    if (query.status) filter.status = query.status;
    // Cashiers only see their own sessions.
    if (!actor.permissions.includes('cash.reconcile')) filter.cashierId = new Types.ObjectId(actor.id);
    else if (query.cashierId) filter.cashierId = new Types.ObjectId(query.cashierId);
    const [items, total] = await Promise.all([
      this.sessions.find(filter).sort({ openedAt: -1 }).skip(query.skip).limit(query.pageSize).populate('cashierId', 'name').lean(),
      this.sessions.countDocuments(filter),
    ]);
    return paginate(items.map(toSessionDto), total, query);
  }

  async get(id: string, actor: AuthUser) {
    const s = await this.sessions.findById(id).populate('cashierId', 'name').lean();
    if (!s) throw new NotFoundError('CashSession', id);
    const cid = (s.cashierId as unknown as { _id: Types.ObjectId })._id.toString();
    if (cid !== actor.id && !actor.permissions.includes('cash.reconcile')) throw new DomainError(ErrorCodes.FORBIDDEN, 'Not your session');
    return toSessionDto(s);
  }
}

@ApiTags('cash-sessions')
@ApiBearerAuth()
@Controller('cash-sessions')
export class CashSessionsController {
  constructor(private readonly service: CashSessionsService) {}

  @Get() @RequirePermissions('cash.session') list(@Query() q: SessionQuery, @CurrentUser() a: AuthUser) {
    return this.service.list(q, a);
  }
  @Get('current') @RequirePermissions('cash.session') current(@CurrentUser() a: AuthUser) {
    return this.service.current(a.id);
  }
  @Get(':id') @RequirePermissions('cash.session') get(@Param('id') id: string, @CurrentUser() a: AuthUser) {
    return this.service.get(id, a);
  }
  @Post('open') @RequirePermissions('cash.session') open(@Body() dto: OpenSessionDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.open(dto, a, r);
  }
  @Post(':id/cash-movements') @RequirePermissions('cash.session') movement(@Param('id') id: string, @Body() dto: CashMovementDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.addMovement(id, dto, a, r);
  }
  @Post(':id/close') @RequirePermissions('cash.session') close(@Param('id') id: string, @Body() dto: CloseSessionDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.close(id, dto, a, r);
  }
  @Post(':id/reconcile') @RequirePermissions('cash.reconcile') reconcile(@Param('id') id: string, @Body() dto: ReconcileDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.reconcile(id, dto, a, r);
  }
}

@Module({ controllers: [CashSessionsController], providers: [CashSessionsService], exports: [CashSessionsService] })
export class CashSessionsModule {}
