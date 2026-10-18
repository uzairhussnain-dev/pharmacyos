import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  GoodsReceiptStatuses,
  PurchaseOrderStatuses,
  PurchaseReturnStatuses,
  type GoodsReceiptStatus,
  type PurchaseOrderStatus,
  type PurchaseReturnStatus,
} from '@pharmacy-os/shared-types';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'suppliers' })
export class Supplier {
  @Prop({ required: true, trim: true, maxlength: 160 })
  name: string;

  @Prop({ trim: true, maxlength: 120 })
  contactName?: string;

  @Prop({ trim: true, maxlength: 40 })
  phone?: string;

  @Prop({ trim: true, lowercase: true, maxlength: 160 })
  email?: string;

  @Prop({ trim: true, maxlength: 300 })
  address?: string;

  /** Net payment terms in days (0 = cash on delivery). */
  @Prop({ default: 0, min: 0 })
  paymentTermsDays: number;

  @Prop({ default: 7, min: 0 })
  leadTimeDays: number;

  @Prop({ trim: true, maxlength: 40 })
  ntn?: string;

  @Prop({ trim: true, maxlength: 40 })
  strn?: string;

  @Prop({ default: false })
  acceptsExpiryReturns: boolean;

  @Prop({ default: true })
  isActive: boolean;

  createdAt: Date;
  updatedAt: Date;
}
export type SupplierDocument = HydratedDocument<Supplier>;
export const SupplierSchema = SchemaFactory.createForClass(Supplier);
SupplierSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

@Schema({ _id: false })
export class PurchaseOrderLine {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  productName: string;

  @Prop({ required: true, min: 1, validate: Number.isInteger })
  quantityUnits: number;

  @Prop({ default: 0, min: 0, validate: Number.isInteger })
  receivedUnits: number;

  @Prop({ required: true, min: 0, validate: Number.isInteger })
  unitCostMinor: number;
}
const PurchaseOrderLineSchema = SchemaFactory.createForClass(PurchaseOrderLine);

@Schema({ timestamps: true, collection: 'purchase_orders' })
export class PurchaseOrder {
  @Prop({ required: true, unique: true })
  poNumber: string;

  @Prop({ type: Types.ObjectId, ref: 'Supplier', required: true, index: true })
  supplierId: Types.ObjectId;

  @Prop({ required: true, enum: PurchaseOrderStatuses, type: String, default: 'DRAFT' })
  status: PurchaseOrderStatus;

  @Prop({ type: [PurchaseOrderLineSchema], required: true })
  lines: PurchaseOrderLine[];

  @Prop()
  expectedDeliveryDate?: Date;

  @Prop({ required: true, min: 0 })
  totalMinor: number;

  @Prop({ trim: true, maxlength: 500 })
  notes?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdById: Types.ObjectId;

  @Prop()
  submittedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}
export type PurchaseOrderDocument = HydratedDocument<PurchaseOrder>;
export const PurchaseOrderSchema = SchemaFactory.createForClass(PurchaseOrder);
PurchaseOrderSchema.index({ status: 1, expectedDeliveryDate: 1 });

@Schema({ _id: false })
export class GoodsReceiptLine {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Batch' })
  batchId?: Types.ObjectId;

  @Prop({ required: true, trim: true, uppercase: true })
  batchNumber: string;

  @Prop({ required: true })
  expiryDate: Date;

  @Prop({ required: true, min: 1, validate: Number.isInteger })
  quantityUnits: number;

  @Prop({ required: true, min: 0, validate: Number.isInteger })
  unitCostMinor: number;

  @Prop({ default: 0, min: 0, validate: Number.isInteger })
  landedUnitCostMinor: number;
}
const GoodsReceiptLineSchema = SchemaFactory.createForClass(GoodsReceiptLine);

@Schema({ timestamps: true, collection: 'goods_receipts' })
export class GoodsReceipt {
  @Prop({ required: true, unique: true })
  grnNumber: string;

  @Prop({ type: Types.ObjectId, ref: 'PurchaseOrder', index: true })
  purchaseOrderId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Supplier', required: true })
  supplierId: Types.ObjectId;

  @Prop({ type: [GoodsReceiptLineSchema], required: true })
  lines: GoodsReceiptLine[];

  @Prop({ required: true, enum: GoodsReceiptStatuses, type: String, default: 'ACCEPTED' })
  status: GoodsReceiptStatus;

  @Prop({ trim: true, maxlength: 80 })
  supplierInvoiceNumber?: string;

  @Prop({ required: true, min: 0 })
  totalCostMinor: number;

  /** Supplier payable created by this receipt; reduced by SupplierPayments. */
  @Prop({ default: 0, min: 0 })
  paidMinor: number;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  receivedById: Types.ObjectId;

  @Prop({ trim: true, maxlength: 500 })
  notes?: string;

  createdAt: Date;
  updatedAt: Date;
}
export type GoodsReceiptDocument = HydratedDocument<GoodsReceipt>;
export const GoodsReceiptSchema = SchemaFactory.createForClass(GoodsReceipt);
GoodsReceiptSchema.index({ supplierId: 1, createdAt: -1 });

@Schema({ _id: false })
export class PurchaseReturnLine {
  @Prop({ type: Types.ObjectId, ref: 'Batch', required: true })
  batchId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ required: true, min: 1, validate: Number.isInteger })
  quantityUnits: number;

  @Prop({ required: true, min: 0 })
  unitCostMinor: number;
}
const PurchaseReturnLineSchema = SchemaFactory.createForClass(PurchaseReturnLine);

@Schema({ timestamps: true, collection: 'purchase_returns' })
export class PurchaseReturn {
  @Prop({ required: true, unique: true })
  prNumber: string;

  @Prop({ type: Types.ObjectId, ref: 'Supplier', required: true, index: true })
  supplierId: Types.ObjectId;

  @Prop({ type: [PurchaseReturnLineSchema], required: true })
  lines: PurchaseReturnLine[];

  @Prop({ required: true, trim: true, maxlength: 300 })
  reason: string;

  @Prop({ required: true, enum: PurchaseReturnStatuses, type: String, default: 'DRAFT' })
  status: PurchaseReturnStatus;

  @Prop({ required: true, min: 0 })
  totalMinor: number;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdById: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  finalizedById?: Types.ObjectId;

  @Prop()
  finalizedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}
export type PurchaseReturnDocument = HydratedDocument<PurchaseReturn>;
export const PurchaseReturnSchema = SchemaFactory.createForClass(PurchaseReturn);
