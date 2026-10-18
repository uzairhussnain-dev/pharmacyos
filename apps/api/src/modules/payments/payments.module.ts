import { Body, Controller, Injectable, Module, Param, Post } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Model, Types } from 'mongoose';
import { AuthUser, CurrentUser, RequestId, RequirePermissions } from '../../common/decorators';
import { DomainError, ErrorCodes, NotFoundError } from '../../common/errors';
import { TransactionService } from '../../database/database.module';
import { Payment, PaymentDocument, Sale, SaleDocument } from '../../database/schemas/sales.schema';
import { AuditService } from '../audit/audit.module';
import { CashSessionsModule, CashSessionsService } from '../cash-sessions/cash-sessions.module';

export class RefundDto {
  @IsInt() @Min(1) amountMinor: number;
  @IsString() @MinLength(5) @MaxLength(300) reason: string;
}

/**
 * Standalone (non-return) refund against a specific payment, e.g. an overcharge correction.
 * Stock is NOT affected — use sale returns for merchandise coming back.
 */
@Injectable()
export class PaymentsService {
  constructor(
    @InjectModel(Payment.name) private readonly payments: Model<PaymentDocument>,
    @InjectModel(Sale.name) private readonly sales: Model<SaleDocument>,
    private readonly cashSessions: CashSessionsService,
    private readonly tx: TransactionService,
    private readonly audit: AuditService,
  ) {}

  async refund(paymentId: string, dto: RefundDto, actor: AuthUser, requestId: string) {
    return this.tx.withTransaction(async (session) => {
      const original = await this.payments.findById(paymentId).session(session).lean();
      if (!original || original.amountMinor <= 0) throw new NotFoundError('Payment', paymentId);
      const [agg] = await this.payments.aggregate<{ total: number }>([{ $match: { refundOfPaymentId: original._id } }, { $group: { _id: null, total: { $sum: '$amountMinor' } } }]).session(session);
      const alreadyRefunded = -(agg?.total ?? 0);
      if (alreadyRefunded + dto.amountMinor > original.amountMinor) {
        throw new DomainError(ErrorCodes.REFUND_EXCEEDS_PAID, `Only ${original.amountMinor - alreadyRefunded} remains refundable on this payment`);
      }
      let cashSessionId: Types.ObjectId | undefined;
      if (original.method === 'CASH') {
        const cs = await this.cashSessions.requireOpen(actor.id, session);
        cashSessionId = cs._id;
      }
      const [refund] = await this.payments.create(
        [{ saleId: original.saleId, method: original.method, amountMinor: -dto.amountMinor, status: 'COMPLETED', refundOfPaymentId: original._id, cashSessionId, actorId: new Types.ObjectId(actor.id), reference: dto.reason }],
        { session },
      );
      if (cashSessionId) await this.cashSessions.recordCash(cashSessionId, 'REFUND', dto.amountMinor, refund._id, actor.id, session);

      const [saleAgg] = await this.payments.aggregate<{ total: number }>([{ $match: { saleId: original.saleId, amountMinor: { $lt: 0 } } }, { $group: { _id: null, total: { $sum: '$amountMinor' } } }]).session(session);
      const sale = await this.sales.findById(original.saleId).session(session);
      if (sale) {
        const refunded = -(saleAgg?.total ?? 0);
        sale.paymentStatus = refunded >= sale.paidMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
        await sale.save({ session });
      }
      await this.audit.record({ actorId: actor.id, actorName: actor.name, action: 'payment.refund', entityType: 'Payment', entityId: original._id, after: { amountMinor: dto.amountMinor, method: original.method }, reason: dto.reason, requestId }, session);
      return { id: refund._id.toString(), amountMinor: dto.amountMinor, method: original.method, saleId: original.saleId.toString() };
    });
  }
}

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Post(':id/refund')
  @RequirePermissions('payments.refund')
  @ApiOperation({ summary: 'Refund (part of) a payment without returning stock. Requires a reason.' })
  refund(@Param('id') id: string, @Body() dto: RefundDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.refund(id, dto, a, r);
  }
}

@Module({ imports: [CashSessionsModule], controllers: [PaymentsController], providers: [PaymentsService] })
export class PaymentsModule {}
