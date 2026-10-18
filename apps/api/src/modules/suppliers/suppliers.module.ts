import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { FilterQuery, Model, Types } from 'mongoose';
import { AuthUser, CurrentUser, RequestId, RequirePermissions } from '../../common/decorators';
import { NotFoundError } from '../../common/errors';
import { PaginationQuery, escapeRegex, paginate } from '../../common/pagination';
import { GoodsReceipt, GoodsReceiptDocument, Supplier, SupplierDocument } from '../../database/schemas/purchasing.schema';
import { AuditService } from '../audit/audit.module';

export class CreateSupplierDto {
  @IsString() @MinLength(2) @MaxLength(160) name: string;
  @IsOptional() @IsString() @MaxLength(120) contactName?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(160) email?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsInt() @Min(0) @Max(365) paymentTermsDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(365) leadTimeDays?: number;
  @IsOptional() @IsString() @MaxLength(40) ntn?: string;
  @IsOptional() @IsString() @MaxLength(40) strn?: string;
  @IsOptional() @IsBoolean() acceptsExpiryReturns?: boolean;
}
export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class SupplierQuery extends PaginationQuery {
  @IsOptional() @IsString() isActive?: string;
}

export function toSupplierDto(s: Supplier & { _id: Types.ObjectId }) {
  return { ...s, id: s._id.toString(), _id: undefined, __v: undefined };
}

@Injectable()
export class SuppliersService {
  constructor(
    @InjectModel(Supplier.name) private readonly suppliers: Model<SupplierDocument>,
    @InjectModel(GoodsReceipt.name) private readonly receipts: Model<GoodsReceiptDocument>,
    private readonly audit: AuditService,
  ) {}

  async list(query: SupplierQuery) {
    const filter: FilterQuery<SupplierDocument> = {};
    if (query.q) filter.name = new RegExp(escapeRegex(query.q), 'i');
    if (query.isActive) filter.isActive = query.isActive === 'true';
    const [items, total] = await Promise.all([
      this.suppliers.find(filter).sort({ name: 1 }).skip(query.skip).limit(query.pageSize).lean(),
      this.suppliers.countDocuments(filter),
    ]);
    // Outstanding payable per supplier
    const payables = await this.receipts.aggregate<{ _id: Types.ObjectId; outstanding: number }>([
      { $match: { supplierId: { $in: items.map((s) => s._id) }, status: 'ACCEPTED' } },
      { $group: { _id: '$supplierId', outstanding: { $sum: { $subtract: ['$totalCostMinor', '$paidMinor'] } } } },
    ]);
    const payableMap = new Map(payables.map((p) => [p._id.toString(), p.outstanding]));
    return paginate(
      items.map((s) => ({ ...toSupplierDto(s), outstandingPayableMinor: payableMap.get(s._id.toString()) ?? 0 })),
      total,
      query,
    );
  }

  async get(id: string) {
    const s = await this.suppliers.findById(id).lean();
    if (!s) throw new NotFoundError('Supplier', id);
    const receipts = await this.receipts.find({ supplierId: s._id }).sort({ createdAt: -1 }).limit(20).lean();
    const outstanding = receipts.filter((r) => r.status === 'ACCEPTED').reduce((a, r) => a + r.totalCostMinor - r.paidMinor, 0);
    return {
      ...toSupplierDto(s),
      outstandingPayableMinor: outstanding,
      recentReceipts: receipts.map((r) => ({
        id: r._id.toString(),
        grnNumber: r.grnNumber,
        totalCostMinor: r.totalCostMinor,
        paidMinor: r.paidMinor,
        status: r.status,
        createdAt: r.createdAt,
      })),
    };
  }

  async create(dto: CreateSupplierDto, actor: AuthUser, requestId: string) {
    const s = await this.suppliers.create(dto);
    await this.audit.record({ actorId: actor.id, actorName: actor.name, action: 'supplier.create', entityType: 'Supplier', entityId: s._id, after: { ...dto }, requestId });
    return toSupplierDto(s.toObject());
  }

  async update(id: string, dto: UpdateSupplierDto, actor: AuthUser, requestId: string) {
    const before = await this.suppliers.findById(id).lean();
    if (!before) throw new NotFoundError('Supplier', id);
    const s = await this.suppliers.findByIdAndUpdate(id, { $set: dto }, { new: true }).lean();
    await this.audit.record({ actorId: actor.id, actorName: actor.name, action: 'supplier.update', entityType: 'Supplier', entityId: id, before: { ...before }, after: { ...dto }, requestId });
    return toSupplierDto(s!);
  }
}

@ApiTags('suppliers')
@ApiBearerAuth()
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly service: SuppliersService) {}

  @Get() @RequirePermissions('suppliers.read') list(@Query() q: SupplierQuery) {
    return this.service.list(q);
  }
  @Get(':id') @RequirePermissions('suppliers.read') get(@Param('id') id: string) {
    return this.service.get(id);
  }
  @Post() @RequirePermissions('suppliers.write') create(@Body() dto: CreateSupplierDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.create(dto, a, r);
  }
  @Patch(':id') @RequirePermissions('suppliers.write') update(@Param('id') id: string, @Body() dto: UpdateSupplierDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.update(id, dto, a, r);
  }
}

@Module({ controllers: [SuppliersController], providers: [SuppliersService], exports: [SuppliersService] })
export class SuppliersModule {}
