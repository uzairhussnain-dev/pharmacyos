import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  CashMovementTypes,
  CashSessionStatuses,
  ExpenseCategories,
  LedgerEntryTypes,
  PaymentMethods,
  type CashMovementType,
  type CashSessionStatus,
  type ExpenseCategory,
  type LedgerEntryType,
  type PaymentMethod,
} from '@pharmacy-os/shared-types';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: true })
export class CashMovement {
  _id: Types.ObjectId;

  @Prop({ required: true, enum: CashMovementTypes, type: String })
  type: CashMovementType;

  /** Signed minor units: + into drawer, - out of drawer. */
  @Prop({ required: true, validate: (v: number) => Number.isInteger(v) && v !== 0 })
  amountMinor: number;

  @Prop({ trim: true, maxlength: 300 })
  reason?: string;

  @Prop({ type: Types.ObjectId })
  sourceId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actorId: Types.ObjectId;

  @Prop({ required: true, default: () => new Date() })
  createdAt: Date;
}
const CashMovementSchema = SchemaFactory.createForClass(CashMovement);

@Schema({ timestamps: true, collection: 'cash_sessions' })
export class CashSession {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  cashierId: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  openingFloatMinor: number;

  @Prop({ type: [CashMovementSchema], default: [] })
  movements: CashMovement[];

  // Running totals (minor). Maintained atomically with each movement.
  @Prop({ default: 0 })
  cashSalesMinor: number;

  @Prop({ default: 0 })
  cashRefundsMinor: number;

  @Prop({ default: 0 })
  cashInMinor: number;

  @Prop({ default: 0 })
  cashOutMinor: number;

  @Prop()
  expectedClosingMinor?: number;

  @Prop()
  countedClosingMinor?: number;

  @Prop()
  varianceMinor?: number;

  @Prop({ required: true, enum: CashSessionStatuses, type: String, default: 'OPEN' })
  status: CashSessionStatus;

  @Prop({ required: true, default: () => new Date() })
  openedAt: Date;

  @Prop()
  closedAt?: Date;

  @Prop()
  reconciledAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reconciledById?: Types.ObjectId;

  @Prop({ trim: true, maxlength: 500 })
  notes?: string;

  createdAt: Date;
  updatedAt: Date;
}
export type CashSessionDocument = HydratedDocument<CashSession>;
export const CashSessionSchema = SchemaFactory.createForClass(CashSession);
// One OPEN session per cashier at a time.
CashSessionSchema.index({ cashierId: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'OPEN' } });
CashSessionSchema.index({ status: 1, openedAt: -1 });

@Schema({ timestamps: true, collection: 'expenses' })
export class Expense {
  @Prop({ required: true, enum: ExpenseCategories, type: String })
  category: ExpenseCategory;

  @Prop({ required: true, min: 1, validate: Number.isInteger })
  amountMinor: number;

  @Prop({ required: true, index: true })
  date: Date;

  @Prop({ required: true, enum: PaymentMethods, type: String })
  paymentMethod: PaymentMethod;

  @Prop({ required: true, trim: true, maxlength: 300 })
  description: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdById: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  approvedById?: Types.ObjectId;

  @Prop()
  approvedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'CashSession' })
  cashSessionId?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}
export type ExpenseDocument = HydratedDocument<Expense>;
export const ExpenseSchema = SchemaFactory.createForClass(Expense);
ExpenseSchema.index({ category: 1, date: -1 });

@Schema({ timestamps: true, collection: 'customers' })
export class Customer {
  @Prop({ required: true, trim: true, maxlength: 120 })
  name: string;

  @Prop({ trim: true, maxlength: 40, index: true })
  phone?: string;

  @Prop({ trim: true, maxlength: 300 })
  notes?: string;

  @Prop({ default: false })
  consentToContact: boolean;

  @Prop({ default: false })
  creditEnabled: boolean;

  @Prop({ default: 0, min: 0 })
  creditLimitMinor: number;

  /** Outstanding receivable (minor). Maintained by ledger entries. */
  @Prop({ default: 0 })
  balanceMinor: number;

  @Prop({ default: true })
  isActive: boolean;

  createdAt: Date;
  updatedAt: Date;
}
export type CustomerDocument = HydratedDocument<Customer>;
export const CustomerSchema = SchemaFactory.createForClass(Customer);
CustomerSchema.index({ name: 'text', phone: 'text' });

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'customer_ledger_entries' })
export class CustomerLedgerEntry {
  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true, index: true })
  customerId: Types.ObjectId;

  @Prop({ required: true, enum: LedgerEntryTypes, type: String })
  type: LedgerEntryType;

  /** Signed: + increases what the customer owes; - reduces it. */
  @Prop({ required: true, validate: (v: number) => Number.isInteger(v) && v !== 0 })
  amountMinor: number;

  @Prop({ required: true })
  sourceType: string;

  @Prop({ type: Types.ObjectId })
  sourceId?: Types.ObjectId;

  @Prop({ trim: true, maxlength: 300 })
  note?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actorId: Types.ObjectId;

  @Prop({ required: true })
  balanceAfterMinor: number;

  createdAt: Date;
}
export type CustomerLedgerEntryDocument = HydratedDocument<CustomerLedgerEntry>;
export const CustomerLedgerEntrySchema = SchemaFactory.createForClass(CustomerLedgerEntry);

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'supplier_payments' })
export class SupplierPayment {
  @Prop({ type: Types.ObjectId, ref: 'Supplier', required: true, index: true })
  supplierId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'GoodsReceipt', required: true, index: true })
  goodsReceiptId: Types.ObjectId;

  @Prop({ required: true, min: 1, validate: Number.isInteger })
  amountMinor: number;

  @Prop({ required: true, enum: PaymentMethods, type: String })
  method: PaymentMethod;

  @Prop({ trim: true, maxlength: 120 })
  reference?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actorId: Types.ObjectId;

  createdAt: Date;
}
export type SupplierPaymentDocument = HydratedDocument<SupplierPayment>;
export const SupplierPaymentSchema = SchemaFactory.createForClass(SupplierPayment);
