import { Body, Controller, Get, Global, Injectable, Module, Patch } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Model } from 'mongoose';
import { AuthUser, CurrentUser, RequestId, RequirePermissions } from '../../common/decorators';
import { SystemSettings, SystemSettingsDocument } from '../../database/schemas/system.schema';
import { AuditService } from '../audit/audit.module';

export class UpdateSettingsDto {
  @IsOptional() @IsString() @MaxLength(120) pharmacyName?: string;
  @IsOptional() @IsString() @MaxLength(300) addressLine?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(80) licenseNumber?: string;
  @IsOptional() @IsString() @MaxLength(60) timezone?: string;
  @IsOptional() @IsString() @MaxLength(10) invoicePrefix?: string;
  @IsOptional() @IsString() @MaxLength(300) receiptFooter?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10000) defaultTaxRateBps?: number;
  @IsOptional() @IsInt() @Min(1) @Max(730) expiryWarningDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) expiryCriticalDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(365) stockoutWarningDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(365) returnWindowDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10000) maxCashierDiscountBps?: number;
  @IsOptional() @IsBoolean() allowCustomerCredit?: boolean;
  @IsOptional() @IsBoolean() requirePrescriptionConfirmation?: boolean;
  @IsOptional() @IsBoolean() blockControlledSalesAtPos?: boolean;
  @IsOptional() @IsIn(['FEFO']) allocationStrategy?: string;
}

@Injectable()
export class SettingsService {
  private cache?: { value: SystemSettings; at: number };

  constructor(
    @InjectModel(SystemSettings.name) private readonly model: Model<SystemSettingsDocument>,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<SystemSettings> {
    if (this.cache && Date.now() - this.cache.at < 5_000) return this.cache.value;
    const existing = await this.model.findOne({ key: 'default' }).lean();
    const doc: SystemSettings = existing ?? ((await this.model.create({ key: 'default' })).toObject() as SystemSettings);
    this.cache = { value: doc, at: Date.now() };
    return doc;
  }

  async update(dto: UpdateSettingsDto, actor: AuthUser, requestId: string) {
    const before = await this.get();
    const doc = await this.model.findOneAndUpdate({ key: 'default' }, { $set: dto }, { new: true, upsert: true }).lean();
    this.cache = undefined;
    await this.audit.record({
      actorId: actor.id,
      actorName: actor.name,
      action: 'settings.update',
      entityType: 'SystemSettings',
      before: pick(before as unknown as Record<string, unknown>, Object.keys(dto)),
      after: { ...dto },
      requestId,
    });
    return doc;
  }
}

function pick(obj: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @Get()
  @RequirePermissions('settings.read')
  get() {
    return this.service.get();
  }

  @Patch()
  @RequirePermissions('settings.write')
  update(@Body() dto: UpdateSettingsDto, @CurrentUser() actor: AuthUser, @RequestId() rid: string) {
    return this.service.update(dto, actor, rid);
  }
}

@Global()
@Module({ controllers: [SettingsController], providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
