import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  PaymentMethods,
  PaymentStatuses,
  ReturnDispositions,
  SaleReturnStatuses,
  SaleStatuses,
  type PaymentMethod,
  type PaymentStatus,
  type ReturnDisposition,
  type SaleReturnStatus,
  type SaleStatus,
} from '@pharmacy-os/shared-types';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false })
export class SaleAllocation {
  @Prop({ type: Types.ObjectId, ref: 'Batch', required: true })
  batchId: Types.ObjectId;

  @Prop({ required: true })
  batchNumber: string;

  @Prop({ required: true })
  expiryDate: Date;

  @Prop({ required: true, min: 1 })
  quantityUnits: number;

  @Prop({ required: true, min: 0 })
  unitCostMinor: number;
}
const SaleAllocationSchema = SchemaFactory.createForClass(SaleAllocation);

@Schema({ _id: false })
export class SaleLine {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  // --- Immutable snapshots at time of sale ---
  @Prop({ required: true })
  sku: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  unitName: string;

  @Prop({ required: true, min: 1 })
  unitMultiplier: number;

  /** Quantity in the chosen unit (e.g. 2 strips). */
  @Prop({ required: true, min: 1 })
  quantity: number;

  /** quantity * unitMultiplier, base units. */
  @Prop({ required: true, min: 1 })
  quantityUnits: number;

  /** Price per chosen unit (minor). */
  @Prop({ required: true, min: 0 })
  unitPriceMinor: number;

  @Prop({ default: 0, min: 0 })
  discountMinor: number;

  @Prop({ default: 0, min: 0 })
  taxRateBps: number;

  @Prop({ default: 0, min: 0 })
  taxMinor: number;

  /** (unitPrice * quantity) - discount + tax */
  @Prop({ required: true, min: 0 })
  lineTotalMinor: number;

  /** Sum of allocation units * unit cost (minor). Preserved for historical COGS. */
  @Prop({ required: true, min: 0 })
  costBasisMinor: number;

  @Prop({ type: [SaleAllocationSchema], required: true })
  allocations: SaleAllocation[];

  @Prop({ default: 0, min: 0 })
  returnedUnits: number;

  @Prop({ default: false })
  prescriptionVerified: boolean;
}
const SaleLineSchema = SchemaFactory.createForClass(SaleLine);

@Schema({ timestamps: true, collection: 'sales' })
export class Sale {
  @Prop({ required: true, unique: true })
  invoiceNumber: string;

  /** Scoped idempotency key `${cashierId}:${clientKey}` — unique. */
  @Prop({ required: true, unique: true })
  idempotencyKey: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  cashierId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Customer' })
  customerId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'CashSession', index: true })
  cashSessionId?: Types.ObjectId;

  @Prop({ type: [SaleLineSchema], required: true })
  lines: SaleLine[];

  @Prop({ required: true, min: 0 })
  subtotalMinor: number;

  /** Sum of line discounts + order-level discount. */
  @Prop({ default: 0, min: 0 })
  discountMinor: number;

  @Prop({ default: 0, min: 0 })
  taxMinor: number;

  @Prop({ required: true, min: 0 })
  totalMinor: number;

  @Prop({ required: true, min: 0 })
  costMinor: number;

  @Prop({ required: true, min: 0 })
  paidMinor: number;

  @Prop({ default: 0, min: 0 })
  changeMinor: number;

  @Prop({ required: true, enum: PaymentStatuses, type: String })
  paymentStatus: PaymentStatus;

  @Prop({ required: true, enum: SaleStatuses, type: String, default: 'COMPLETED' })
  status: SaleStatus;

  @Prop({ trim: true, maxlength: 300 })
  notes?: string;

  @Prop({ trim: true, maxlength: 128 })
  requestId?: string;

  createdAt: Date;
  updatedAt: Date;
}
export type SaleDocument = HydratedDocument<Sale>;
export const SaleSchema = SchemaFactory.createForClass(Sale);
SaleSchema.index({ createdAt: -1 });
SaleSchema.index({ 'lines.productId': 1, createdAt: -1 });
SaleSchema.index({ customerId: 1, createdAt: -1 }, { sparse: true });

@Schema({ timestamps: true, collection: 'payments' })
export class Payment {
  @Prop({ type: Types.ObjectId, ref: 'Sale', required: true, index: true })
  saleId: Types.ObjectId;

  @Prop({ required: true, enum: PaymentMethods, type: String })
  method: PaymentMethod;

  /** Positive for payments, negative for refunds. */
  @Prop({ required: true, validate: (v: number) => Number.isInteger(v) && v !== 0 })
  amountMinor: number;

  @Prop({ required: true, enum: PaymentStatuses, type: String, default: 'COMPLETED' })
  status: PaymentStatus;

  @Prop({ trim: true, maxlength: 120 })
  reference?: string;

  @Prop({ trim: true, maxlength: 40 })
  provider?: string;

  /** For refunds: the original payment being (partially) refunded. */
  @Prop({ type: Types.ObjectId, ref: 'Payment' })
  refundOfPaymentId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SaleReturn' })
  saleReturnId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'CashSession' })
  cashSessionId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actorId: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}
export type PaymentDocument = HydratedDocument<Payment>;
export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ method: 1, createdAt: -1 });
PaymentSchema.index({ cashSessionId: 1 }, { sparse: true });

@Schema({ _id: false })
export class SaleReturnLine {
  @Prop({ required: true, min: 0 })
  lineIndex: number;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, min: 1 })
  quantityUnits: number;

  @Prop({ required: true, enum: ReturnDispositions, type: String })
  disposition: ReturnDisposition;

  /** Which batch the returned units are posted back to (restock/quarantine) — original allocation batch. */
  @Prop({ type: Types.ObjectId, ref: 'Batch', required: true })
  batchId: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  refundMinor: number;

  @Prop({ required: true, min: 0 })
  costBasisMinor: number;
}
const SaleReturnLineSchema = SchemaFactory.createForClass(SaleReturnLine);

@Schema({ timestamps: true, collection: 'sale_returns' })
export class SaleReturn {
  @Prop({ required: true, unique: true })
  returnNumber: string;

  @Prop({ type: Types.ObjectId, ref: 'Sale', required: true, index: true })
  saleId: Types.ObjectId;

  @Prop({ type: [SaleReturnLineSchema], required: true })
  lines: SaleReturnLine[];

  @Prop({ required: true, min: 0 })
  refundMinor: number;

  @Prop({ required: true, enum: PaymentMethods, type: String })
  refundMethod: PaymentMethod;

  @Prop({ required: true, trim: true, maxlength: 300 })
  reason: string;

  @Prop({ required: true, enum: SaleReturnStatuses, type: String, default: 'PENDING_APPROVAL' })
  status: SaleReturnStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  requestedById: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  approvedById?: Types.ObjectId;

  @Prop()
  approvedAt?: Date;

  @Prop({ trim: true, maxlength: 300 })
  rejectionReason?: string;

  createdAt: Date;
  updatedAt: Date;
}
export type SaleReturnDocument = HydratedDocument<SaleReturn>;
export const SaleReturnSchema = SchemaFactory.createForClass(SaleReturn);
