import { Controller, Get, Global, Injectable, Module, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { IsOptional, IsString } from 'class-validator';
import { AuditLog, AuditLogDocument } from '../../database/schemas/system.schema';
import { RequirePermissions } from '../../common/decorators';
import { PaginationQuery, paginate } from '../../common/pagination';

const REDACT_KEYS = new Set(['password', 'passwordHash', 'token', 'refreshToken', 'accessToken', 'secret', 'authorization']);

/** Deep-clone and strip any sensitive keys before persisting to audit. Mongoose docs/arrays are converted to plain objects. */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 12) return '[TRUNCATED]' as unknown as T;
  if (value && typeof value === 'object' && typeof (value as { toObject?: unknown }).toObject === 'function') {
    value = (value as unknown as { toObject(): T }).toObject();
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as unknown as T;
  if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof Types.ObjectId) && !Buffer.isBuffer(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.startsWith('$') || k === '__v') continue;
      out[k] = REDACT_KEYS.has(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

export interface AuditEntry {
  actorId?: string | Types.ObjectId;
  actorName?: string;
  action: string;
  entityType: string;
  entityId?: string | Types.ObjectId;
  requestId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
  ip?: string;
}

@Injectable()
export class AuditService {
  constructor(@InjectModel(AuditLog.name) private readonly model: Model<AuditLogDocument>) {}

  async record(entry: AuditEntry, session?: ClientSession): Promise<void> {
    await this.model.create(
      [
        {
          ...entry,
          actorId: entry.actorId ? new Types.ObjectId(entry.actorId) : undefined,
          entityId: entry.entityId ? new Types.ObjectId(entry.entityId) : undefined,
          before: entry.before ? redact(entry.before) : undefined,
          after: entry.after ? redact(entry.after) : undefined,
        },
      ],
      { session: session ?? null },
    );
  }

  async list(query: AuditQuery) {
    const filter: FilterQuery<AuditLogDocument> = {};
    if (query.action) filter.action = { $regex: `^${query.action}` };
    if (query.entityType) filter.entityType = query.entityType;
    if (query.entityId && Types.ObjectId.isValid(query.entityId)) filter.entityId = new Types.ObjectId(query.entityId);
    if (query.actorId && Types.ObjectId.isValid(query.actorId)) filter.actorId = new Types.ObjectId(query.actorId);
    if (query.from || query.to) {
      filter.createdAt = {};
      if (query.from) filter.createdAt.$gte = new Date(query.from);
      if (query.to) filter.createdAt.$lte = new Date(query.to);
    }
    const [items, total] = await Promise.all([
      this.model.find(filter).sort({ createdAt: -1 }).skip(query.skip).limit(query.pageSize).lean(),
      this.model.countDocuments(filter),
    ]);
    return paginate(items, total, query);
  }
}

export class AuditQuery extends PaginationQuery {
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsString() entityType?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() actorId?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit.read')
  list(@Query() query: AuditQuery) {
    return this.audit.list(query);
  }
}

@Global()
@Module({
  providers: [AuditService],
  controllers: [AuditController],
  exports: [AuditService],
})
export class AuditModule {}
