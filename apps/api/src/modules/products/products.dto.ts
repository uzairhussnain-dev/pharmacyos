import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { SaleRestrictions, type SaleRestriction } from '@pharmacy-os/shared-types';
import { PaginationQuery } from '../../common/pagination';

export class PackUnitDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(30) name: string;
  @ApiProperty() @IsInt() @Min(1) @Max(100000) multiplier: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) barcode?: string;
  @ApiPropertyOptional({ description: 'Minor units' }) @IsOptional() @IsInt() @Min(0) sellingPriceMinor?: number;
}

export class CreateProductDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(40) @Matches(/^[A-Za-z0-9-_.]+$/) sku: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) barcode?: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(160) brandName: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(160) genericName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) strength?: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) dosageForm: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) route?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) manufacturer?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) registrationNumber?: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) category: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(30) baseUnit: string;
  @ApiPropertyOptional({ type: [PackUnitDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PackUnitDto)
  packUnits?: PackUnitDto[];
  @ApiProperty({ description: 'Price per base unit in minor units' }) @IsInt() @Min(0) sellingPriceMinor: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) taxClass?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10000) taxRateBps?: number;
  @ApiPropertyOptional({ enum: SaleRestrictions }) @IsOptional() @IsIn(SaleRestrictions) saleRestriction?: SaleRestriction;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresPrescription?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() tracksExpiry?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) reorderLevel?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) reorderQuantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(365) leadTimeDays?: number;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ProductQuery extends PaginationQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() category?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) isActive?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) lowStock?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['name', 'sku', 'stock', 'updated']) sort?: string;
}
