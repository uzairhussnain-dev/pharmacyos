import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { MovementTypes, type MovementType } from '@pharmacy-os/shared-types';
import { HydratedDocument, Types } from 'mongoose';

/**
 * Append-only stock ledger. Never updated or deleted. Corrections are new compensating rows.
 * Invariant: sum(quantityUnits) per batch === batch.onHandUnits (verified by reconciliation).
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'stock_movements' })
export class StockMovement {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, index: true })
  productId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Batch', required: true, index: true })
  batchId: Types.ObjectId;

  @Prop({ required: true, enum: MovementTypes, type: String })
  type: MovementType;

  /** Signed base units: positive = stock in, negative = stock out. */
  @Prop({ required: true, validate: (v: number) => Number.isInteger(v) && v !== 0 })
  quantityUnits: number;

  /** Unit cost snapshot (minor) for valuation of this movement. */
  @Prop({ required: true, min: 0 })
  unitCostMinor: number;

  @Prop({ required: true, trim: true })
  sourceType: string; // e.g. 'GoodsReceipt' | 'Sale' | 'SaleReturn' | 'StockCount' | 'Adjustment' | 'PurchaseReturn'

  @Prop({ type: Types.ObjectId })
  sourceId?: Types.ObjectId;

  @Prop({ trim: true, maxlength: 300 })
  reason?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actorId: Types.ObjectId;

  @Prop({ trim: true, maxlength: 128 })
  requestId?: string;

  /** Resulting batch balance after this movement (denormalised for fast audit reading). */
  @Prop({ required: true })
  balanceAfterUnits: number;

  createdAt: Date;
}

export type StockMovementDocument = HydratedDocument<StockMovement>;
export const StockMovementSchema = SchemaFactory.createForClass(StockMovement);
StockMovementSchema.index({ createdAt: -1 });
StockMovementSchema.index({ sourceType: 1, sourceId: 1 });
StockMovementSchema.index({ type: 1, createdAt: -1 });
StockMovementSchema.index({ productId: 1, createdAt: -1 });
