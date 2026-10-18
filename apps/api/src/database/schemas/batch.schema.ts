import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { BatchStatuses, ExpiryPrecisions, type BatchStatus, type ExpiryPrecision } from '@pharmacy-os/shared-types';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'batches' })
export class Batch {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, index: true })
  productId: Types.ObjectId;

  /** Normalized (uppercased, trimmed) batch number. */
  @Prop({ required: true, uppercase: true, trim: true, maxlength: 60 })
  batchNumber: string;

  @Prop({ trim: true, maxlength: 60 })
  supplierLot?: string;

  /** For MONTH precision the date is stored as the last day of that month. */
  @Prop({ required: true })
  expiryDate: Date;

  @Prop({ required: true, enum: ExpiryPrecisions, type: String, default: 'DAY' })
  expiryPrecision: ExpiryPrecision;

  /** Supplier invoice cost per base unit (minor). */
  @Prop({ required: true, min: 0, validate: Number.isInteger })
  purchaseCostMinor: number;

  /** Cost per base unit including freight/other landed costs (minor). Used for COGS. */
  @Prop({ required: true, min: 0, validate: Number.isInteger })
  landedUnitCostMinor: number;

  @Prop({ required: true, min: 0, validate: Number.isInteger })
  receivedUnits: number;

  @Prop({ required: true, min: 0, validate: Number.isInteger })
  onHandUnits: number;

  @Prop({ default: 0, min: 0, validate: Number.isInteger })
  reservedUnits: number;

  @Prop({ required: true, enum: BatchStatuses, type: String, default: 'ACTIVE' })
  status: BatchStatus;

  @Prop({ type: Types.ObjectId, ref: 'GoodsReceipt' })
  receiptId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Supplier' })
  supplierId?: Types.ObjectId;

  @Prop({ required: true, default: () => new Date() })
  receivedAt: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdById?: Types.ObjectId;

  @Prop({ trim: true, maxlength: 300 })
  statusReason?: string;

  createdAt: Date;
  updatedAt: Date;
}

export type BatchDocument = HydratedDocument<Batch>;
export const BatchSchema = SchemaFactory.createForClass(Batch);
// Same product+batch number received twice (e.g. two receipts) is allowed only with different receipts.
BatchSchema.index({ productId: 1, batchNumber: 1, receiptId: 1 }, { unique: true });
// FEFO allocation query
BatchSchema.index({ productId: 1, status: 1, expiryDate: 1 });
BatchSchema.index({ expiryDate: 1, status: 1 });
BatchSchema.index({ status: 1, onHandUnits: 1 });

/** Business rule: a batch is sellable only when ACTIVE, not expired, and has free units. */
export function isBatchEligible(batch: Pick<Batch, 'status' | 'expiryDate' | 'onHandUnits' | 'reservedUnits'>, now = new Date()): boolean {
  if (batch.status !== 'ACTIVE') return false;
  if (batch.expiryDate.getTime() <= startOfDay(now).getTime()) return false;
  return batch.onHandUnits - (batch.reservedUnits ?? 0) > 0;
}

export function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}
