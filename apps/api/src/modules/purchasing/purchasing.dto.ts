import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ExpiryPrecisions, PaymentMethods, type ExpiryPrecision, type PaymentMethod } from '@pharmacy-os/shared-types';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../common/pagination';

export class PoLineDto {
  @IsMongoId() productId: string;
  @IsInt() @Min(1) quantityUnits: number;
  @IsInt() @Min(0) unitCostMinor: number;
}

export class CreatePurchaseOrderDto {
  @IsMongoId() supplierId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => PoLineDto) lines: PoLineDto[];
  @IsOptional() @IsDateString() expectedDeliveryDate?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class UpdatePurchaseOrderDto {
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => PoLineDto) lines?: PoLineDto[];
  @IsOptional() @IsDateString() expectedDeliveryDate?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsIn(['CANCELLED']) status?: 'CANCELLED';
}

export class ReceiveLineDto {
  @IsMongoId() productId: string;
  @IsString() @MinLength(1) @MaxLength(60) batchNumber: string;
  @IsDateString() expiryDate: string;
  @IsOptional() @IsIn(ExpiryPrecisions) expiryPrecision?: ExpiryPrecision;
  @IsInt() @Min(1) quantityUnits: number;
  @IsInt() @Min(0) unitCostMinor: number;
  @IsOptional() @IsInt() @Min(0) landedUnitCostMinor?: number;
  @IsOptional() @IsString() @MaxLength(60) supplierLot?: string;
}

export class ReceiveDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ReceiveLineDto) lines: ReceiveLineDto[];
  @IsOptional() @IsString() @MaxLength(80) supplierInvoiceNumber?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

/** Direct receipt without a PO (e.g. opening stock, urgent counter purchase). */
export class DirectReceiveDto extends ReceiveDto {
  @IsMongoId() supplierId: string;
}

export class PurchaseReturnLineDto {
  @IsMongoId() batchId: string;
  @IsInt() @Min(1) quantityUnits: number;
}

export class CreatePurchaseReturnDto {
  @IsMongoId() supplierId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => PurchaseReturnLineDto) lines: PurchaseReturnLineDto[];
  @IsString() @MinLength(3) @MaxLength(300) reason: string;
}

export class SupplierPaymentDto {
  @IsMongoId() goodsReceiptId: string;
  @IsInt() @Min(1) amountMinor: number;
  @IsIn(PaymentMethods) method: PaymentMethod;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
}

export class PoQuery extends PaginationQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() supplierId?: string;
}
