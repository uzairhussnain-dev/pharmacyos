/* eslint-disable no-console */
/**
 * Seed realistic (fictional) demo data for a single Pakistani pharmacy.
 *
 *   pnpm --filter @pharmacy-os/api seed            # seeds if DB is empty
 *   pnpm --filter @pharmacy-os/api seed -- --reset # drops and re-seeds (refuses in production)
 *
 * All transactions go through the real services (ledger, checkout, returns) so the resulting
 * data is internally consistent and reconciliation passes.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../app.module';
import { AuthUser } from '../common/decorators';
import { TransactionService } from '../database/database.module';
import { Product, ProductDocument } from '../database/schemas/product.schema';
import { Supplier, SupplierDocument } from '../database/schemas/purchasing.schema';
import { User, UserDocument } from '../database/schemas/user.schema';
import { Customer, CustomerDocument } from '../database/schemas/finance.schema';
import { Sale, SaleDocument } from '../database/schemas/sales.schema';
import { RolePermissions } from '@pharmacy-os/shared-types';
import { AuthService } from '../modules/auth/auth.service';
import { PurchasingService } from '../modules/purchasing/purchasing.service';
import { PosService } from '../modules/pos/pos.service';
import { CashSessionsService } from '../modules/cash-sessions/cash-sessions.module';
import { SalesService } from '../modules/sales/sales.module';
import { AlertsEngine } from '../modules/intelligence/alerts.engine';
import { SettingsService } from '../modules/settings/settings.module';
import { ExpensesService } from '../modules/expenses/expenses.module';
import { PRODUCTS, SUPPLIERS } from './seed-data';

const DEMO_PASSWORD = 'Demo@12345';

function rng(seed: number) {
  // Mulberry32 — deterministic
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const reset = process.argv.includes('--reset');
  if (reset && process.env.NODE_ENV === 'production') throw new Error('Refusing to --reset in production');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] });
  await app.init();
  const tx = app.get(TransactionService);
  // Native collections bypass Mongoose's immutable createdAt so seed history can be backdated.
  const raw = (name: string) => tx.conn.collection(name);
  const users = app.get<Model<UserDocument>>(getModelToken(User.name));
  const products = app.get<Model<ProductDocument>>(getModelToken(Product.name));
  const suppliers = app.get<Model<SupplierDocument>>(getModelToken(Supplier.name));
  const customers = app.get<Model<CustomerDocument>>(getModelToken(Customer.name));
  const sales = app.get<Model<SaleDocument>>(getModelToken(Sale.name));

  if (reset) {
    console.log('Dropping database…');
    await tx.conn.dropDatabase();
  } else if ((await users.countDocuments()) > 0) {
    console.log('Database already seeded (users exist). Use --reset to re-seed. Exiting.');
    await app.close();
    return;
  }

  console.log('Seeding users…');
  const mk = async (name: string, username: string, role: keyof typeof RolePermissions) => {
    const u = await users.create({ name, username, passwordHash: await AuthService.hashPassword(DEMO_PASSWORD), role, isActive: true });
    return { id: u._id.toString(), username, name, role, permissions: RolePermissions[role], tokenVersion: 0 } as AuthUser;
  };
  const owner = await mk('Dr. Ayesha Siddiqui', 'owner', 'OWNER');
  const manager = await mk('Bilal Ahmed', 'manager', 'MANAGER');
  const pharmacist = await mk('Sana Malik', 'pharmacist', 'PHARMACIST');
  const cashier = await mk('Usman Tariq', 'cashier', 'CASHIER');
  const cashier2 = await mk('Hira Qureshi', 'cashier2', 'CASHIER');
  const stock = await mk('Kamran Shah', 'stock', 'STOCK_MANAGER');
  void stock;

  const settings = app.get(SettingsService);
  await settings.update({ pharmacyName: 'Shifa Pharmacy', addressLine: 'Shop 4, Block C, Gulberg III, Lahore', phone: '+92 42 3575 0000', licenseNumber: 'PB-LHR-DEMO-0001', receiptFooter: 'Thank you for choosing Shifa Pharmacy. Keep medicines out of reach of children. Returns within 14 days with receipt.' }, owner, 'seed');

  console.log('Seeding suppliers & products…');
  const supplierDocs = await suppliers.insertMany(SUPPLIERS);
  const productDocs = await products.insertMany(PRODUCTS);
  const byCategory = new Map<string, ProductDocument[]>();
  for (const p of productDocs) byCategory.set(p.category, [...(byCategory.get(p.category) ?? []), p]);

  console.log('Seeding customers…');
  const customerDocs = await customers.insertMany([
    { name: 'Walk-in Regular — Mrs. Farhat', phone: '0300-1234567', creditEnabled: true, creditLimitMinor: 1_000_000, consentToContact: true },
    { name: 'Dr. Naveed Clinic', phone: '0321-7654321', creditEnabled: true, creditLimitMinor: 5_000_000, consentToContact: true },
    { name: 'Ali Raza', phone: '0333-9876543', creditEnabled: false, creditLimitMinor: 0 },
  ]);

  console.log('Receiving stock (goods receipts)…');
  const purchasing = app.get(PurchasingService);
  const rand = rng(42);
  const days = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
  // Each product gets 1–2 batches. ~15% get a near-expiry batch, a few get already-expired stock (to show write-off flows).
  for (let i = 0; i < productDocs.length; i += 6) {
    const chunk = productDocs.slice(i, i + 6);
    const supplier = supplierDocs[i % supplierDocs.length];
    const lines = chunk.flatMap((p, idx) => {
      const unitCost = Math.round(p.sellingPriceMinor * (0.62 + rand() * 0.15));
      const qty = (p.reorderQuantity || 100) * (2 + Math.floor(rand() * 3));
      const main = { productId: p._id.toString(), batchNumber: `B${(1000 + i + idx).toString()}`, expiryDate: days(240 + Math.floor(rand() * 500)), quantityUnits: qty, unitCostMinor: unitCost };
      const extra = [];
      const roll = rand();
      if (roll < 0.15) extra.push({ productId: p._id.toString(), batchNumber: `N${(2000 + i + idx).toString()}`, expiryDate: days(20 + Math.floor(rand() * 60)), quantityUnits: Math.ceil(qty * 0.6), unitCostMinor: unitCost });
      else if (roll < 0.3) extra.push({ productId: p._id.toString(), batchNumber: `L${(3000 + i + idx).toString()}`, expiryDate: days(500 + Math.floor(rand() * 300)), quantityUnits: Math.ceil(qty * 0.5), unitCostMinor: Math.round(unitCost * 1.04) });
      return [main, ...extra];
    });
    await purchasing.receiveDirect({ supplierId: supplier._id.toString(), lines, supplierInvoiceNumber: `SI-${7000 + i}` }, manager, 'seed');
  }
  // A couple of PO's in flight (one overdue) for the Action Center
  const poA = await purchasing.createOrder({ supplierId: supplierDocs[0]._id.toString(), lines: productDocs.slice(0, 3).map((p) => ({ productId: p._id.toString(), quantityUnits: 200, unitCostMinor: Math.round(p.sellingPriceMinor * 0.7) })), expectedDeliveryDate: days(-4) }, manager, 'seed');
  await purchasing.submitOrder(poA.id, manager, 'seed');
  const poB = await purchasing.createOrder({ supplierId: supplierDocs[1]._id.toString(), lines: productDocs.slice(10, 14).map((p) => ({ productId: p._id.toString(), quantityUnits: 100, unitCostMinor: Math.round(p.sellingPriceMinor * 0.7) })), expectedDeliveryDate: days(3) }, manager, 'seed');
  await purchasing.submitOrder(poB.id, manager, 'seed');

  // Backdate receipts/batches/movements so history looks like it accumulated over ~75 days
  const back = 75;
  await raw('batches').updateMany({}, [{ $set: { receivedAt: { $dateSubtract: { startDate: '$receivedAt', unit: 'day', amount: back } }, createdAt: { $dateSubtract: { startDate: '$createdAt', unit: 'day', amount: back } } } }]);
  await raw('stock_movements').updateMany({ type: 'RECEIPT' }, [{ $set: { createdAt: { $dateSubtract: { startDate: '$createdAt', unit: 'day', amount: back } } } }]);
  await raw('goods_receipts').updateMany({}, [{ $set: { createdAt: { $dateSubtract: { startDate: '$createdAt', unit: 'day', amount: back } } } }]);

  console.log('Generating 70 days of sales…');
  const pos = app.get(PosService);
  const cashSessions = app.get(CashSessionsService);
  const salesSvc = app.get(SalesService);
  const popular = productDocs.filter((p) => ['Analgesic', 'Antibiotic', 'Antihistamine', 'Gastro', 'Vitamins'].includes(p.category));
  const others = productDocs.filter((p) => !popular.includes(p));
  let invoiceCount = 0;
  const saleIds: string[] = [];

  for (let d = 70; d >= 0; d--) {
    const dayStart = new Date(); dayStart.setDate(dayStart.getDate() - d); dayStart.setHours(9, 0, 0, 0);
    const isToday = d === 0;
    // Replenish every ~12 days: products at/below 1.5x reorder level get a fresh batch (backdated to that day).
    if (d % 12 === 0 && d > 0) {
      const low = await products.find({ $expr: { $lte: ['$eligibleUnits', { $multiply: ['$reorderLevel', 1.5] }] } }).lean();
      if (low.length) {
        const supplier = supplierDocs[Math.floor(rand() * supplierDocs.length)];
        const grn = await purchasing.receiveDirect(
          {
            supplierId: supplier._id.toString(),
            lines: low.map((p, idx) => ({ productId: p._id.toString(), batchNumber: `R${d}-${idx}`, expiryDate: days(300 + Math.floor(rand() * 400)), quantityUnits: Math.max(p.reorderQuantity, p.reorderLevel * 2, 50), unitCostMinor: Math.round(p.sellingPriceMinor * (0.62 + rand() * 0.15)) })),
            supplierInvoiceNumber: `SI-R${d}`,
          },
          manager,
          'seed',
        );
        await raw('goods_receipts').updateOne({ _id: new Types.ObjectId(grn.id) }, { $set: { createdAt: dayStart } });
        await raw('batches').updateMany({ receiptId: new Types.ObjectId(grn.id) }, { $set: { receivedAt: dayStart, createdAt: dayStart } });
        await raw('stock_movements').updateMany({ sourceId: new Types.ObjectId(grn.id) }, { $set: { createdAt: dayStart } });
      }
    }
    for (const c of [cashier, cashier2]) {
      const sess = await cashSessions.open({ openingFloatMinor: 500_000 }, c, 'seed');
      const perDay = 6 + Math.floor(rand() * 8) + (dayStart.getDay() === 5 ? 4 : 0); // busier Fridays
      for (let k = 0; k < (isToday ? Math.ceil(perDay / 2) : perDay); k++) {
        const nLines = 1 + Math.floor(rand() * 3);
        const lines = [];
        for (let l = 0; l < nLines; l++) {
          const pick = rand() < 0.75 ? popular[Math.floor(rand() * popular.length)] : others[Math.floor(rand() * others.length)];
          const pack = pick.packUnits[0];
          const usePack = pack && rand() < 0.6;
          lines.push({ productId: pick._id.toString(), unitName: usePack ? pack.name : undefined, quantity: usePack ? 1 + Math.floor(rand() * 2) : 1 + Math.floor(rand() * 10), prescriptionVerified: true });
        }
        const customer = rand() < 0.08 ? customerDocs[Math.floor(rand() * 2)] : undefined;
        try {
          const quote = await pos.quote({ lines }, c);
          const method = rand() < 0.78 ? 'CASH' : rand() < 0.6 ? 'CARD' : 'MOBILE_WALLET';
          const tenders = customer && rand() < 0.5 ? [{ method: 'CREDIT' as const, amountMinor: quote.totalMinor }] : [{ method: method as 'CASH', amountMinor: method === 'CASH' ? Math.ceil(quote.totalMinor / 10000) * 10000 : quote.totalMinor }];
          const actor = tenders[0].method === 'CREDIT' ? pharmacist : c;
          if (actor !== c) await cashSessions.open({ openingFloatMinor: 0 }, actor, 'seed').catch(() => undefined);
          const sale = await pos.checkout({ idempotencyKey: randomUUID(), lines, tenders, customerId: customer?._id.toString() }, actor, 'seed');
          saleIds.push(sale.id);
          invoiceCount++;
          const ts = new Date(dayStart.getTime() + Math.floor(rand() * 11 * 3600_000));
          if (!isToday) {
            await raw('sales').updateOne({ _id: new Types.ObjectId(sale.id) }, { $set: { createdAt: ts, updatedAt: ts } });
            await raw('stock_movements').updateMany({ sourceId: new Types.ObjectId(sale.id) }, { $set: { createdAt: ts } });
            await raw('payments').updateMany({ saleId: new Types.ObjectId(sale.id) }, { $set: { createdAt: ts } });
          }
        } catch {
          // out of stock for that pick — skip
        }
      }
      if (!isToday) {
        const cur = await cashSessions.current(c.id);
        if (cur) {
          const variance = rand() < 0.2 ? -(Math.floor(rand() * 20) * 100) : 0;
          await cashSessions.close(cur.id, { countedClosingMinor: cur.expectedClosingMinor + variance }, c, 'seed');
          if (rand() < 0.85) await cashSessions.reconcile(cur.id, {}, manager, 'seed');
          await raw('cash_sessions').updateOne({ _id: new Types.ObjectId(cur.id) }, { $set: { openedAt: dayStart, closedAt: new Date(dayStart.getTime() + 12 * 3600_000), createdAt: dayStart } });
        }
      }
    }
    const ph = await cashSessions.current(pharmacist.id);
    if (ph && !isToday) await cashSessions.close(ph.id, { countedClosingMinor: ph.expectedClosingMinor }, pharmacist, 'seed');
  }
  console.log(`  ${invoiceCount} sales created.`);

  console.log('Recording a few returns…');
  await cashSessions.open({ openingFloatMinor: 0 }, pharmacist, 'seed').catch(() => undefined);
  let returnsMade = 0;
  for (const id of saleIds.slice(-60).filter((_, i) => i % 7 === 0)) {
    const s = await sales.findById(id).lean();
    if (!s || s.lines[0].quantityUnits < 2 || s.lines[0].returnedUnits > 0) continue;
    try {
      await salesSvc.createReturn(id, { lines: [{ lineIndex: 0, quantityUnits: 1, disposition: rand() < 0.5 ? 'RESTOCK' : 'QUARANTINE' }], reason: 'Customer returned unopened item', refundMethod: 'CASH' }, pharmacist, 'seed');
      returnsMade++;
    } catch (e) {
      console.warn('  return skipped:', (e as Error).message);
    }
  }
  console.log(`  ${returnsMade} returns recorded.`);

  console.log('Adding near-expiry slow-moving batches (expiry rescue demo)…');
  const slow = productDocs.filter((p) => ['NEB-SOL', 'LEX-1', 'BET-CRM', 'D3-200K', 'INS-MIX'].includes(p.sku));
  const nearGrn = await purchasing.receiveDirect(
    { supplierId: supplierDocs[1]._id.toString(), lines: slow.map((p, i) => ({ productId: p._id.toString(), batchNumber: `NE${i + 1}`, expiryDate: days(18 + i * 11), quantityUnits: Math.max(40, p.reorderQuantity), unitCostMinor: Math.round(p.sellingPriceMinor * 0.7) })), supplierInvoiceNumber: 'SI-NEAR' },
    manager,
    'seed',
  );
  const nearDate = new Date(Date.now() - 50 * 86400_000);
  await raw('goods_receipts').updateOne({ _id: new Types.ObjectId(nearGrn.id) }, { $set: { createdAt: nearDate } });
  await raw('batches').updateMany({ receiptId: new Types.ObjectId(nearGrn.id) }, { $set: { receivedAt: nearDate, createdAt: nearDate } });
  await raw('stock_movements').updateMany({ sourceId: new Types.ObjectId(nearGrn.id) }, { $set: { createdAt: nearDate } });
  // One already-expired batch to demonstrate write-off handling (inserted directly; receiving expired stock is blocked by the API)
  const exp = productDocs.find((p) => p.sku === 'ORS-1')!;
  const expiredBatchId = new Types.ObjectId();
  await raw('batches').insertOne({ _id: expiredBatchId, productId: exp._id, batchNumber: 'OLD-ORS', expiryDate: new Date(Date.now() - 6 * 86400_000), expiryPrecision: 'DAY', purchaseCostMinor: 2000, landedUnitCostMinor: 2000, receivedUnits: 30, onHandUnits: 30, reservedUnits: 0, status: 'ACTIVE', supplierId: supplierDocs[2]._id, receivedAt: new Date(Date.now() - 200 * 86400_000), createdAt: new Date(Date.now() - 200 * 86400_000), updatedAt: new Date(), __v: 0 });
  await raw('stock_movements').insertOne({ productId: exp._id, batchId: expiredBatchId, type: 'RECEIPT', quantityUnits: 30, unitCostMinor: 2000, sourceType: 'GoodsReceipt', actorId: new Types.ObjectId(manager.id), balanceAfterUnits: 30, createdAt: new Date(Date.now() - 200 * 86400_000) });
  await raw('products').updateOne({ _id: exp._id }, { $inc: { onHandUnits: 30 } });

  const ph2 = await cashSessions.current(pharmacist.id);
  if (ph2) await cashSessions.close(ph2.id, { countedClosingMinor: ph2.expectedClosingMinor }, pharmacist, 'seed');

  console.log('Recording expenses…');
  const expenses = app.get(ExpensesService);
  for (let m = 0; m < 3; m++) {
    const date = new Date(); date.setMonth(date.getMonth() - m, 1);
    await expenses.create({ category: 'RENT', amountMinor: 12_000_000, date: date.toISOString(), paymentMethod: 'BANK_TRANSFER', description: 'Shop rent' }, owner, 'seed');
    await expenses.create({ category: 'SALARIES', amountMinor: 28_500_000, date: date.toISOString(), paymentMethod: 'BANK_TRANSFER', description: 'Staff salaries' }, owner, 'seed');
    await expenses.create({ category: 'UTILITIES', amountMinor: 3_200_000 + Math.floor(rand() * 400_000), date: date.toISOString(), paymentMethod: 'CASH', description: 'LESCO + SNGPL + internet' }, owner, 'seed');
  }

  console.log('Evaluating alerts…');
  const result = await app.get(AlertsEngine).evaluateAll();
  console.log(`  alerts: ${JSON.stringify(result)}`);

  await app.close();
  console.log('\nSeed complete. Demo logins (password for all: ' + DEMO_PASSWORD + '):');
  for (const u of ['owner', 'manager', 'pharmacist', 'cashier', 'cashier2', 'stock']) console.log(`  ${u}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
