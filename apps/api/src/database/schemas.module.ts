import { Global, Injectable, Module } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { Batch, BatchSchema } from './schemas/batch.schema';
import {
  CashSession,
  CashSessionSchema,
  Customer,
  CustomerLedgerEntry,
  CustomerLedgerEntrySchema,
  CustomerSchema,
  Expense,
  ExpenseSchema,
  SupplierPayment,
  SupplierPaymentSchema,
} from './schemas/finance.schema';
import { Product, ProductSchema } from './schemas/product.schema';
import {
  GoodsReceipt,
  GoodsReceiptSchema,
  PurchaseOrder,
  PurchaseOrderSchema,
  PurchaseReturn,
  PurchaseReturnSchema,
  Supplier,
  SupplierSchema,
} from './schemas/purchasing.schema';
import { Payment, PaymentSchema, Sale, SaleReturn, SaleReturnSchema, SaleSchema } from './schemas/sales.schema';
import { StockMovement, StockMovementSchema } from './schemas/stock-movement.schema';
import {
  Alert,
  AlertSchema,
  AuditLog,
  AuditLogSchema,
  Counter,
  CounterDocument,
  CounterSchema,
  ForecastSnapshot,
  ForecastSnapshotSchema,
  HeldCart,
  HeldCartSchema,
  StockCount,
  StockCountSchema,
  SystemSettings,
  SystemSettingsSchema,
} from './schemas/system.schema';
import { User, UserSchema } from './schemas/user.schema';
import { IdempotencyRecord, IdempotencyRecordSchema } from './schemas/idempotency.schema';

export const ALL_SCHEMAS = [
  { name: User.name, schema: UserSchema },
  { name: IdempotencyRecord.name, schema: IdempotencyRecordSchema },
  { name: Product.name, schema: ProductSchema },
  { name: Batch.name, schema: BatchSchema },
  { name: StockMovement.name, schema: StockMovementSchema },
  { name: Supplier.name, schema: SupplierSchema },
  { name: PurchaseOrder.name, schema: PurchaseOrderSchema },
  { name: GoodsReceipt.name, schema: GoodsReceiptSchema },
  { name: PurchaseReturn.name, schema: PurchaseReturnSchema },
  { name: Sale.name, schema: SaleSchema },
  { name: Payment.name, schema: PaymentSchema },
  { name: SaleReturn.name, schema: SaleReturnSchema },
  { name: CashSession.name, schema: CashSessionSchema },
  { name: Expense.name, schema: ExpenseSchema },
  { name: Customer.name, schema: CustomerSchema },
  { name: CustomerLedgerEntry.name, schema: CustomerLedgerEntrySchema },
  { name: SupplierPayment.name, schema: SupplierPaymentSchema },
  { name: AuditLog.name, schema: AuditLogSchema },
  { name: Alert.name, schema: AlertSchema },
  { name: ForecastSnapshot.name, schema: ForecastSnapshotSchema },
  { name: StockCount.name, schema: StockCountSchema },
  { name: SystemSettings.name, schema: SystemSettingsSchema },
  { name: Counter.name, schema: CounterSchema },
  { name: HeldCart.name, schema: HeldCartSchema },
];

@Injectable()
export class CounterService {
  constructor(@InjectModel(Counter.name) private readonly counters: Model<CounterDocument>) {}

  /** Atomically returns the next sequence value for `key`. Safe inside transactions. */
  async next(key: string, session?: ClientSession): Promise<number> {
    const doc = await this.counters.findOneAndUpdate(
      { key },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, session: session ?? null },
    );
    return doc.seq;
  }

  /** e.g. INV-2026-000042 */
  async nextNumber(prefix: string, session?: ClientSession): Promise<string> {
    const year = new Date().getFullYear();
    const seq = await this.next(`${prefix}-${year}`, session);
    return `${prefix}-${year}-${String(seq).padStart(6, '0')}`;
  }
}

@Global()
@Module({
  imports: [MongooseModule.forFeature(ALL_SCHEMAS)],
  providers: [CounterService],
  exports: [MongooseModule, CounterService],
})
export class SchemasModule {}
