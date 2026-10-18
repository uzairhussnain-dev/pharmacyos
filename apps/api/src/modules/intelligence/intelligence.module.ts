import { Doc } from '../../common/types';
import { Body, Controller, Get, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { FilterQuery, Model, Types } from 'mongoose';
import { AuthUser, CurrentUser, RequestId, RequirePermissions } from '../../common/decorators';
import { DomainError, ErrorCodes, NotFoundError } from '../../common/errors';
import { PaginationQuery, paginate } from '../../common/pagination';
import { Alert, AlertDocument, ForecastSnapshot, ForecastSnapshotDocument } from '../../database/schemas/system.schema';
import { Batch, BatchDocument } from '../../database/schemas/batch.schema';
import { AuditService } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { ReportsModule } from '../reports/reports.module';
import { AlertsEngine } from './alerts.engine';
import { AssistantService } from './assistant.service';

export class ResolveAlertDto {
  @IsIn(['ACKNOWLEDGE', 'RESOLVE', 'DISMISS']) decision: 'ACKNOWLEDGE' | 'RESOLVE' | 'DISMISS';
  @IsOptional() @IsString() @MaxLength(60) actionCode?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class AssistantQueryDto {
  @IsString() @MinLength(3) @MaxLength(500) question: string;
}
class AlertQuery extends PaginationQuery {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() severity?: string;
}

@Injectable()
export class IntelligenceService {
  constructor(
    @InjectModel(Alert.name) private readonly alerts: Model<AlertDocument>,
    @InjectModel(ForecastSnapshot.name) private readonly forecasts: Model<ForecastSnapshotDocument>,
    @InjectModel(Batch.name) private readonly batches: Model<BatchDocument>,
    private readonly engine: AlertsEngine,
    private readonly audit: AuditService,
  ) {}

  async list(query: AlertQuery) {
    const filter: FilterQuery<AlertDocument> = {};
    filter.status = query.status ? { $in: query.status.split(',') } : { $in: ['OPEN', 'ACKNOWLEDGED'] };
    if (query.type) filter.type = { $in: query.type.split(',') };
    if (query.severity) filter.severity = { $in: query.severity.split(',') };
    const [items, total, counts] = await Promise.all([
      this.alerts.find(filter).sort({ severityRank: 1, estimatedImpactMinor: -1, updatedAt: -1 }).skip(query.skip).limit(query.pageSize).lean(),
      this.alerts.countDocuments(filter),
      this.alerts.aggregate<{ _id: { type: string; severity: string }; count: number; impact: number }>([{ $match: { status: { $in: ['OPEN', 'ACKNOWLEDGED'] } } }, { $group: { _id: { type: '$type', severity: '$severity' }, count: { $sum: 1 }, impact: { $sum: { $ifNull: ['$estimatedImpactMinor', 0] } } } }]),
    ]);
    const summary: Record<string, { count: number; impactMinor: number; bySeverity: Record<string, number> }> = {};
    for (const c of counts) {
      const s = (summary[c._id.type] ??= { count: 0, impactMinor: 0, bySeverity: {} });
      s.count += c.count;
      s.impactMinor += c.impact;
      s.bySeverity[c._id.severity] = c.count;
    }
    return { ...paginate(items.map(toAlertDto), total, query), summary, lastEvaluatedAt: items[0]?.lastEvaluatedAt };
  }

  async get(id: string) {
    const a = await this.alerts.findById(id).lean();
    if (!a) throw new NotFoundError('Alert', id);
    return toAlertDto(a);
  }

  /** APPROVE → EXECUTE (by the user, via href) → MEASURE (outcome snapshot captured here). */
  async resolve(id: string, dto: ResolveAlertDto, actor: AuthUser, requestId: string) {
    const a = await this.alerts.findById(id);
    if (!a) throw new NotFoundError('Alert', id);
    if (a.status === 'RESOLVED' || a.status === 'DISMISSED') throw new DomainError(ErrorCodes.INVALID_STATE_TRANSITION, `Alert is already ${a.status}`);
    const before = a.status;
    if (dto.decision === 'ACKNOWLEDGE') {
      a.status = 'ACKNOWLEDGED';
    } else {
      a.status = dto.decision === 'RESOLVE' ? 'RESOLVED' : 'DISMISSED';
      a.resolution = { actorId: new Types.ObjectId(actor.id), actionCode: dto.actionCode ?? dto.decision, note: dto.note, resolvedAt: new Date(), outcome: await this.measureOutcome(a) };
    }
    await a.save();
    await this.audit.record({ actorId: actor.id, actorName: actor.name, action: `alert.${dto.decision.toLowerCase()}`, entityType: 'Alert', entityId: a._id, before: { status: before }, after: { status: a.status, actionCode: dto.actionCode }, reason: dto.note, requestId });
    return toAlertDto(a.toObject());
  }

  /** Captures a measurable "after" snapshot so the owner can compare against the alert evidence later. */
  private async measureOutcome(a: AlertDocument): Promise<Record<string, unknown>> {
    if (a.type === 'EXPIRY_RISK' && a.entityId) {
      const b = await this.batches.findById(a.entityId).lean();
      if (b) return { onHandUnitsAtResolution: b.onHandUnits, statusAtResolution: b.status, exposureAtResolutionMinor: b.onHandUnits * b.landedUnitCostMinor, originalProjectedLossMinor: a.estimatedImpactMinor };
    }
    if ((a.type === 'STOCKOUT_RISK' || a.type === 'LOW_STOCK') && a.entityId) {
      const [agg] = await this.batches.aggregate<{ total: number }>([{ $match: { productId: a.entityId, status: 'ACTIVE', expiryDate: { $gt: new Date() } } }, { $group: { _id: null, total: { $sum: '$onHandUnits' } } }]);
      return { eligibleUnitsAtResolution: agg?.total ?? 0, eligibleUnitsAtDetection: a.evidence?.eligibleUnits };
    }
    return { capturedAt: new Date() };
  }

  async rebuild(actor: AuthUser, requestId: string) {
    const result = await this.engine.evaluateAll();
    await this.audit.record({ actorId: actor.id, actorName: actor.name, action: 'intelligence.rebuild', entityType: 'Alert', after: result as unknown as Record<string, unknown>, requestId });
    return result;
  }

  async latestForecasts(productId?: string) {
    const filter: FilterQuery<ForecastSnapshotDocument> = productId ? { productId: new Types.ObjectId(productId) } : {};
    const latest = await this.forecasts.aggregate<Record<string, unknown>>([{ $match: filter }, { $sort: { createdAt: -1 } }, { $group: { _id: '$productId', doc: { $first: '$$ROOT' } } }, { $replaceRoot: { newRoot: '$doc' } }, { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'p' } }, { $addFields: { productName: { $arrayElemAt: ['$p.brandName', 0] }, sku: { $arrayElemAt: ['$p.sku', 0] } } }, { $project: { p: 0 } }, { $sort: { daysOfCoverRemaining: 1 } }, { $limit: 100 }]);
    return latest.map((f) => ({ ...f, id: String(f._id), productId: String(f.productId), _id: undefined }));
  }
}

export function toAlertDto(a: Doc) {
  const res = a.resolution as Record<string, unknown> | undefined;
  return { id: String(a._id), type: a.type, severity: a.severity, status: a.status, title: a.title, explanation: a.explanation, evidence: a.evidence, estimatedImpactMinor: a.estimatedImpactMinor, recommendedActions: a.recommendedActions, entityType: a.entityType, entityId: a.entityId ? String(a.entityId) : undefined, resolution: res ? { ...res, actorId: res.actorId ? String(res.actorId) : undefined } : undefined, lastEvaluatedAt: a.lastEvaluatedAt, createdAt: a.createdAt, updatedAt: a.updatedAt };
}

@ApiTags('intelligence')
@ApiBearerAuth()
@Controller('intelligence')
export class IntelligenceController {
  constructor(
    private readonly service: IntelligenceService,
    private readonly assistant: AssistantService,
  ) {}

  @Get('actions') @RequirePermissions('intelligence.read') list(@Query() q: AlertQuery) {
    return this.service.list(q);
  }
  @Get('actions/:id') @RequirePermissions('intelligence.read') get(@Param('id') id: string) {
    return this.service.get(id);
  }
  @Post('actions/:id/resolve') @RequirePermissions('intelligence.resolve') resolve(@Param('id') id: string, @Body() dto: ResolveAlertDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.resolve(id, dto, a, r);
  }
  @Post('forecast/rebuild') @RequirePermissions('intelligence.rebuild')
  @ApiOperation({ summary: 'Re-run the alert engine and forecast snapshots now.' })
  rebuild(@CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.rebuild(a, r);
  }
  @Get('forecasts') @RequirePermissions('intelligence.read') forecasts(@Query('productId') productId?: string) {
    return this.service.latestForecasts(productId);
  }
  @Get('assistant/tools') @RequirePermissions('intelligence.read') tools(@CurrentUser() a: AuthUser) {
    return this.assistant.listTools(a);
  }
  @Post('assistant/query') @RequirePermissions('intelligence.read')
  @ApiOperation({ summary: 'Ask a business question. Answered from approved, permission-filtered reporting tools.' })
  ask(@Body() dto: AssistantQueryDto, @CurrentUser() a: AuthUser) {
    return this.assistant.query(dto.question, a);
  }
}

@Module({
  imports: [InventoryModule, ReconciliationModule, ReportsModule],
  controllers: [IntelligenceController],
  providers: [IntelligenceService, AlertsEngine, AssistantService],
  exports: [IntelligenceService, AlertsEngine],
})
export class IntelligenceModule {}
