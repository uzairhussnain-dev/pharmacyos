import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { BatchStatuses, type BatchStatus } from '@pharmacy-os/shared-types';
import {
  ArrayMinSize,
  IsArray,
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

export class BatchQuery extends PaginationQuery {
  @ApiPropertyOptional() @IsOptional() @IsMongoId() productId?: string;
  @ApiPropertyOptional({ enum: BatchStatuses }) @IsOptional() @IsIn(BatchStatuses) status?: BatchStatus;
  @ApiPropertyOptional({ description: 'Only batches expiring within N days' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expiringWithinDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) inStock?: string;
}

export class MovementQuery extends PaginationQuery {
  @ApiPropertyOptional() @IsOptional() @IsMongoId() productId?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() batchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() type?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() to?: string;
}

export class AdjustStockDto {
  @IsMongoId() batchId: string;
  /** Signed base units. */
  @IsInt() quantityUnits: number;
  @IsString() @MinLength(5) @MaxLength(300) reason: string;
}

export class BatchStatusDto {
  @IsIn(['ACTIVE', 'QUARANTINED', 'RECALLED']) status: 'ACTIVE' | 'QUARANTINED' | 'RECALLED';
  @IsString() @MinLength(5) @MaxLength(300) reason: string;
}

export class CountLineDto {
  @IsMongoId() batchId: string;
  @IsInt() @Min(0) countedUnits: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class CreateCountDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CountLineDto) lines: CountLineDto[];
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class RejectCountDto {
  @IsString() @MinLength(3) @MaxLength(300) reason: string;
}
