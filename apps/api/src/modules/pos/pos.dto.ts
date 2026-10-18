import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethods, type PaymentMethod } from '@pharmacy-os/shared-types';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CartLineDto {
  @ApiProperty() @IsMongoId() productId: string;
  @ApiPropertyOptional({ description: 'Pack unit name; omit for base unit' }) @IsOptional() @IsString() @MaxLength(30) unitName?: string;
  @ApiProperty() @IsInt() @Min(1) @Max(100000) quantity: number;
  @ApiPropertyOptional({ description: 'Line discount in minor units' }) @IsOptional() @IsInt() @Min(0) discountMinor?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() prescriptionVerified?: boolean;
}

export class TenderDto {
  @ApiProperty({ enum: PaymentMethods }) @IsIn(PaymentMethods) method: PaymentMethod;
  @ApiProperty() @IsInt() @Min(1) amountMinor: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) reference?: string;
}

export class QuoteDto {
  @ApiProperty({ type: [CartLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CartLineDto)
  lines: CartLineDto[];

  @ApiPropertyOptional({ description: 'Order-level discount in minor units' }) @IsOptional() @IsInt() @Min(0) orderDiscountMinor?: number;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() customerId?: string;
}

export class CheckoutDto extends QuoteDto {
  @ApiProperty({ description: 'Client-generated unique key per checkout attempt (UUID).' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey: string;

  @ApiProperty({ type: [TenderDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => TenderDto)
  tenders: TenderDto[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class HoldCartDto {
  @IsOptional() @IsString() @MaxLength(80) label?: string;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => CartLineDto) lines: CartLineDto[];
  @IsOptional() @IsInt() @Min(0) orderDiscountMinor?: number;
  @IsOptional() @IsMongoId() customerId?: string;
}
