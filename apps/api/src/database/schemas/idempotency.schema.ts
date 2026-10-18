import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

/**
 * Idempotency ledger for POS checkout.
 * - key is scoped: `${cashierId}:${clientKey}`
 * - A PENDING row is inserted before the sale transaction starts; the unique index makes a
 *   concurrent duplicate fail fast (409 IN_PROGRESS) instead of racing the transaction.
 * - On commit the row becomes COMPLETED with the saleId; a retry with the same request hash
 *   returns the committed sale. Different hash → 422 IDEMPOTENCY_MISMATCH.
 * - On failure the row is deleted so the client may retry.
 */
@Schema({ timestamps: true, collection: 'idempotency_records' })
export class IdempotencyRecord {
  @Prop({ required: true, unique: true })
  key: string;

  @Prop({ required: true })
  requestHash: string;

  @Prop({ required: true, enum: ['PENDING', 'COMPLETED'], default: 'PENDING' })
  status: 'PENDING' | 'COMPLETED';

  @Prop({ type: Types.ObjectId, ref: 'Sale' })
  saleId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.Mixed })
  response?: Record<string, unknown>;

  @Prop({ required: true })
  expiresAt: Date;

  createdAt: Date;
  updatedAt: Date;
}
export type IdempotencyRecordDocument = HydratedDocument<IdempotencyRecord>;
export const IdempotencyRecordSchema = SchemaFactory.createForClass(IdempotencyRecord);
IdempotencyRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
