import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  AlertSeverities,
  AlertStatuses,
  AlertTypes,
  StockCountStatuses,
  type AlertSeverity,
  type AlertStatus,
  type AlertType,
  type StockCountStatus,
} from '@pharmacy-os/shared-types';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'audit_logs' })
export class AuditLog {
  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  actorId?: Types.ObjectId;

  @Prop({ trim: true })
  actorName?: string;

  @Prop({ required: true, trim: true, index: true })
  action: string; // e.g. 'product.create', 'sale.checkout', 'auth.login'

  @Prop({ required: true, trim: true })
  entityType: string;

  @Prop({ type: Types.ObjectId, index: true })
  entityId?: Types.ObjectId;

  @Prop({ trim: true, maxlength: 128 })
  requestId?: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  before?: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed })
  after?: Record<string, unknown>;

  @Prop({ trim: true, maxlength: 500 })
  reason?: string;

  @Prop({ trim: true, maxlength: 64 })
  ip?: string;

  createdAt: Date;
}
export type AuditLogDocument = HydratedDocument<AuditLog>;
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

@Schema({ _id: false })
export class RecommendedAction {
  @Prop({ required: true })
  code: string;

  @Prop({ required: true })
  label: string;

  @Prop({ required: true })
  description: string;

  @Prop()
  href?: string;
}
const RecommendedActionSchema = SchemaFactory.createForClass(RecommendedAction);

@Schema({ timestamps: true, collection: 'alerts' })
export class Alert {
  @Prop({ required: true, enum: AlertTypes, type: String, index: true })
  type: AlertType;

  @Prop({ required: true, enum: AlertSeverities, type: String })
  severity: AlertSeverity;

  /** 0 = CRITICAL … 4 = INFO; denormalised for DB-side sorting. */
  @Prop({ required: true, default: 2 })
  severityRank: number;

  @Prop({ required: true, enum: AlertStatuses, type: String, default: 'OPEN', index: true })
  status: AlertStatus;

  /** Stable key used to upsert the same logical alert across engine runs (e.g. `EXPIRY_RISK:batchId`). */
  @Prop({ required: true, unique: true })
  dedupeKey: string;

  @Prop({ required: true, trim: true, maxlength: 200 })
  title: string;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  explanation: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  evidence: Record<string, unknown>;

  @Prop()
  estimatedImpactMinor?: number;

  @Prop({ type: [RecommendedActionSchema], default: [] })
  recommendedActions: RecommendedAction[];

  @Prop()
  entityType?: string;

  @Prop({ type: Types.ObjectId })
  entityId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.Mixed })
  resolution?: {
    actorId: Types.ObjectId;
    actionCode: string;
    note?: string;
    resolvedAt: Date;
    outcome?: Record<string, unknown>;
  };

  @Prop({ required: true, default: () => new Date() })
  lastEvaluatedAt: Date;

  createdAt: Date;
  updatedAt: Date;
}
export type AlertDocument = HydratedDocument<Alert>;
export const AlertSchema = SchemaFactory.createForClass(Alert);
AlertSchema.index({ status: 1, severity: 1, createdAt: -1 });
AlertSchema.index({ entityType: 1, entityId: 1 });

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'forecast_snapshots' })
export class ForecastSnapshot {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, index: true })
  productId: Types.ObjectId;

  @Prop({ required: true })
  dataCutoff: Date;

  @Prop({ required: true })
  horizonDays: number;

  @Prop({ required: true, min: 0 })
  avgDailyDemandUnits: number;

  @Prop({ required: true, min: 0 })
  demandStdDevUnits: number;

  @Prop({ required: true, min: 0 })
  predictedDemandUnits: number;

  @Prop({ type: { low: Number, high: Number } })
  uncertaintyRange?: { low: number; high: number };

  @Prop({ required: true })
  observationDays: number;

  /** True when there is enough history to be meaningful (see docs). */
  @Prop({ required: true })
  isReliable: boolean;

  @Prop({ required: true })
  modelVersion: string;

  @Prop({ required: true, min: 0 })
  eligibleStockUnits: number;

  @Prop({ required: true, min: 0 })
  pendingOrderUnits: number;

  @Prop()
  daysOfCoverRemaining?: number;

  @Prop()
  projectedStockoutDate?: Date;

  @Prop({ required: true, min: 0 })
  suggestedReorderUnits: number;

  createdAt: Date;
}
export type ForecastSnapshotDocument = HydratedDocument<ForecastSnapshot>;
export const ForecastSnapshotSchema = SchemaFactory.createForClass(ForecastSnapshot);
ForecastSnapshotSchema.index({ productId: 1, createdAt: -1 });

@Schema({ _id: false })
export class StockCountLine {
  @Prop({ type: Types.ObjectId, ref: 'Batch', required: true })
  batchId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ required: true })
  productName: string;

  @Prop({ required: true })
  batchNumber: string;

  /** System balance captured when the count line was recorded. */
  @Prop({ required: true, min: 0 })
  systemUnits: number;

  @Prop({ required: true, min: 0, validate: Number.isInteger })
  countedUnits: number;

  @Prop({ trim: true, maxlength: 300 })
  note?: string;
}
const StockCountLineSchema = SchemaFactory.createForClass(StockCountLine);

@Schema({ timestamps: true, collection: 'stock_counts' })
export class StockCount {
  @Prop({ required: true, unique: true })
  countNumber: string;

  @Prop({ required: true, enum: StockCountStatuses, type: String, default: 'DRAFT' })
  status: StockCountStatus;

  @Prop({ type: [StockCountLineSchema], default: [] })
  lines: StockCountLine[];

  @Prop({ trim: true, maxlength: 300 })
  notes?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdById: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  submittedById?: Types.ObjectId;

  @Prop()
  submittedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  approvedById?: Types.ObjectId;

  @Prop()
  approvedAt?: Date;

  @Prop({ trim: true, maxlength: 300 })
  rejectionReason?: string;

  createdAt: Date;
  updatedAt: Date;
}
export type StockCountDocument = HydratedDocument<StockCount>;
export const StockCountSchema = SchemaFactory.createForClass(StockCount);

@Schema({ timestamps: true, collection: 'system_settings' })
export class SystemSettings {
  /** Singleton: always 'default'. */
  @Prop({ required: true, unique: true, default: 'default' })
  key: string;

  @Prop({ default: 'PharmacyOS Demo Pharmacy' })
  pharmacyName: string;

  @Prop({ default: '' })
  addressLine: string;

  @Prop({ default: '' })
  phone: string;

  @Prop({ default: '' })
  licenseNumber: string;

  @Prop({ default: 'Asia/Karachi' })
  timezone: string;

  @Prop({ default: 'PKR' })
  currency: string;

  @Prop({ default: 'INV' })
  invoicePrefix: string;

  @Prop({ default: 'Thank you for choosing us. Keep medicines out of reach of children.' })
  receiptFooter: string;

  @Prop({ default: 0, min: 0, max: 10000 })
  defaultTaxRateBps: number;

  @Prop({ default: 90, min: 1 })
  expiryWarningDays: number;

  @Prop({ default: 30, min: 1 })
  expiryCriticalDays: number;

  @Prop({ default: 7, min: 0 })
  stockoutWarningDays: number;

  @Prop({ default: 14, min: 1 })
  returnWindowDays: number;

  @Prop({ default: 2000, min: 0, max: 10000 })
  maxCashierDiscountBps: number;

  @Prop({ default: true })
  allowCustomerCredit: boolean;

  @Prop({ default: true })
  requirePrescriptionConfirmation: boolean;

  @Prop({ default: false })
  blockControlledSalesAtPos: boolean;

  @Prop({ default: 'FEFO' })
  allocationStrategy: string;

  @Prop({ default: 'BATCH_ACTUAL' })
  costingPolicy: string;

  createdAt: Date;
  updatedAt: Date;
}
export type SystemSettingsDocument = HydratedDocument<SystemSettings>;
export const SystemSettingsSchema = SchemaFactory.createForClass(SystemSettings);

/** Monotonic counters for human-readable document numbers (INV-2026-000123). */
@Schema({ collection: 'counters' })
export class Counter {
  @Prop({ required: true, unique: true })
  key: string;

  @Prop({ required: true, default: 0 })
  seq: number;
}
export type CounterDocument = HydratedDocument<Counter>;
export const CounterSchema = SchemaFactory.createForClass(Counter);

/** Held POS carts (server-side, so they survive refresh and can be resumed on any terminal). */
@Schema({ timestamps: true, collection: 'held_carts' })
export class HeldCart {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  cashierId: Types.ObjectId;

  @Prop({ trim: true, maxlength: 80 })
  label?: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  payload: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}
export type HeldCartDocument = HydratedDocument<HeldCart>;
export const HeldCartSchema = SchemaFactory.createForClass(HeldCart);
