import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Model, Types } from 'mongoose';
import { RequirePermissions } from '../../common/decorators';
import { Batch, BatchDocument, startOfDay } from '../../database/schemas/batch.schema';
import { CashSession, CashSessionDocument, Expense, ExpenseDocument } from '../../database/schemas/finance.schema';
import { Product, ProductDocument } from '../../database/schemas/product.schema';
import { Payment, PaymentDocument, Sale, SaleDocument, SaleReturn, SaleReturnDocument } from '../../database/schemas/sales.schema';
import { StockMovement, StockMovementDocument } from '../../database/schemas/stock-movement.schema';

export class DateRangeQuery {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsIn(['day', 'week', 'month']) groupBy?: 'day' | 'week' | 'month';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export interface Range {
  from: Date;
  to: Date;
}

export function resolveRange(q: { from?: string; to?: string }, defaultDays = 30): Range {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : startOfDay(new Date(to.getTime() - (defaultDays - 1) * 86400_000));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new Error('Invalid date range');
  // Inclusive end-of-day for date-only "to"
  if (q.to && q.to.length <= 10) to.setHours(23, 59, 59, 999);
  return { from, to };
}

/**
 * Profit definitions (see docs/architecture.md#true-profit):
 *   grossSales   = Σ sale.subtotal (before discounts, excl. tax)
 *   discounts    = Σ sale.discount
 *   returns      = Σ approved return refunds (excl. tax portion approximated proportionally)
 *   netSales     = grossSales − discounts − returns
 *   cogs         = Σ sale.cost − Σ returned cost basis (RESTOCK/QUARANTINE only; WRITE_OFF cost stays in COGS as loss)
 *   grossProfit  = netSales − cogs
 *   grossMargin  = grossProfit / netSales
 *   opex         = Σ approved expenses in range
 *   netOperating = grossProfit − opex   (NOT "net profit": excludes tax, depreciation, financing)
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Sale.name) private readonly sales: Model<SaleDocument>,
    @InjectModel(SaleReturn.name) private readonly returns: Model<SaleReturnDocument>,
    @InjectModel(Payment.name) private readonly payments: Model<PaymentDocument>,
    @InjectModel(Expense.name) private readonly expenses: Model<ExpenseDocument>,
    @InjectModel(Batch.name) private readonly batches: Model<BatchDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(StockMovement.name) private readonly movements: Model<StockMovementDocument>,
    @InjectModel(CashSession.name) private readonly sessions: Model<CashSessionDocument>,
  ) {}

  async salesReport(q: DateRangeQuery) {
    const range = resolveRange(q);
    const groupBy = q.groupBy ?? 'day';
    const fmt = groupBy === 'month' ? '%Y-%m' : groupBy === 'week' ? '%G-W%V' : '%Y-%m-%d';
    const [series, totals, byMethod, returnsAgg] = await Promise.all([
      this.sales.aggregate<{ _id: string; grossMinor: number; discountMinor: number; taxMinor: number; totalMinor: number; costMinor: number; count: number }>([
        { $match: { createdAt: { $gte: range.from, $lte: range.to }, status: { $ne: 'VOIDED' } } },
        { $group: { _id: { $dateToString: { format: fmt, date: '$createdAt' } }, grossMinor: { $sum: '$subtotalMinor' }, discountMinor: { $sum: '$discountMinor' }, taxMinor: { $sum: '$taxMinor' }, totalMinor: { $sum: '$totalMinor' }, costMinor: { $sum: '$costMinor' }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      this.sales.aggregate<{ grossMinor: number; discountMinor: number; taxMinor: number; totalMinor: number; costMinor: number; count: number; avgBasketMinor: number }>([
        { $match: { createdAt: { $gte: range.from, $lte: range.to }, status: { $ne: 'VOIDED' } } },
        { $group: { _id: null, grossMinor: { $sum: '$subtotalMinor' }, discountMinor: { $sum: '$discountMinor' }, taxMinor: { $sum: '$taxMinor' }, totalMinor: { $sum: '$totalMinor' }, costMinor: { $sum: '$costMinor' }, count: { $sum: 1 }, avgBasketMinor: { $avg: '$totalMinor' } } },
      ]),
      this.payments.aggregate<{ _id: string; amountMinor: number; count: number }>([
        { $match: { createdAt: { $gte: range.from, $lte: range.to }, amountMinor: { $gt: 0 } } },
        { $group: { _id: '$method', amountMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
        { $sort: { amountMinor: -1 } },
      ]),
      this.returnsInRange(range),
    ]);
    const t = totals[0] ?? { grossMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0, costMinor: 0, count: 0, avgBasketMinor: 0 };
    return {
      range,
      groupBy,
      series: series.map((s) => ({ period: s._id, ...s, _id: undefined })),
      totals: { ...t, returnsMinor: returnsAgg.refundMinor, returnCount: returnsAgg.count, netSalesMinor: t.grossMinor - t.discountMinor - returnsAgg.refundExTaxMinor, avgBasketMinor: Math.round(t.avgBasketMinor ?? 0) },
      paymentMethods: byMethod.map((m) => ({ method: m._id, amountMinor: m.amountMinor, count: m.count })),
    };
  }

  private async returnsInRange(range: Range) {
    const [agg] = await this.returns.aggregate<{ refundMinor: number; costMinor: number; writeOffCostMinor: number; count: number }>([
      { $match: { status: 'APPROVED', approvedAt: { $gte: range.from, $lte: range.to } } },
      { $unwind: '$lines' },
      { $group: { _id: null, refundMinor: { $sum: '$lines.refundMinor' }, costMinor: { $sum: { $cond: [{ $ne: ['$lines.disposition', 'WRITE_OFF'] }, '$lines.costBasisMinor', 0] } }, writeOffCostMinor: { $sum: { $cond: [{ $eq: ['$lines.disposition', 'WRITE_OFF'] }, '$lines.costBasisMinor', 0] } }, count: { $sum: 1 } } },
    ]);
    const r = agg ?? { refundMinor: 0, costMinor: 0, writeOffCostMinor: 0, count: 0 };
    // Refund includes tax; we don't store tax per return line, so treat refund as ex-tax (tax-exempt medicines are the norm in PK).
    return { ...r, refundExTaxMinor: r.refundMinor };
  }

  async grossProfit(q: DateRangeQuery) {
    const range = resolveRange(q);
    const [sales, returns, opex, byProduct] = await Promise.all([
      this.sales.aggregate<{ grossMinor: number; discountMinor: number; costMinor: number; totalMinor: number; taxMinor: number }>([
        { $match: { createdAt: { $gte: range.from, $lte: range.to }, status: { $ne: 'VOIDED' } } },
        { $group: { _id: null, grossMinor: { $sum: '$subtotalMinor' }, discountMinor: { $sum: '$discountMinor' }, costMinor: { $sum: '$costMinor' }, totalMinor: { $sum: '$totalMinor' }, taxMinor: { $sum: '$taxMinor' } } },
      ]),
      this.returnsInRange(range),
      this.expenses.aggregate<{ total: number }>([{ $match: { date: { $gte: range.from, $lte: range.to }, approvedAt: { $ne: null } } }, { $group: { _id: null, total: { $sum: '$amountMinor' } } }]),
      this.sales.aggregate<{ _id: Types.ObjectId; name: string; sku: string; revenueMinor: number; costMinor: number; units: number }>([
        { $match: { createdAt: { $gte: range.from, $lte: range.to }, status: { $ne: 'VOIDED' } } },
        { $unwind: '$lines' },
        { $group: { _id: '$lines.productId', name: { $first: '$lines.name' }, sku: { $first: '$lines.sku' }, revenueMinor: { $sum: { $subtract: [{ $multiply: ['$lines.unitPriceMinor', '$lines.quantity'] }, '$lines.discountMinor'] } }, costMinor: { $sum: '$lines.costBasisMinor' }, units: { $sum: '$lines.quantityUnits' } } },
        { $addFields: { profitMinor: { $subtract: ['$revenueMinor', '$costMinor'] } } },
        { $sort: { profitMinor: -1 } },
        { $limit: q.limit ?? 20 },
      ]),
    ]);
    const s = sales[0] ?? { grossMinor: 0, discountMinor: 0, costMinor: 0, totalMinor: 0, taxMinor: 0 };
    const netSales = s.grossMinor - s.discountMinor - returns.refundExTaxMinor;
    const cogs = s.costMinor - returns.costMinor;
    const grossProfit = netSales - cogs;
    const opexMinor = opex[0]?.total ?? 0;
    return {
      range,
      grossSalesMinor: s.grossMinor,
      discountsMinor: s.discountMinor,
      returnsMinor: returns.refundExTaxMinor,
      netSalesMinor: netSales,
      cogsMinor: cogs,
      returnWriteOffCostMinor: returns.writeOffCostMinor,
      grossProfitMinor: grossProfit,
      grossMarginBps: netSales > 0 ? Math.round((grossProfit / netSales) * 10_000) : 0,
      operatingExpensesMinor: opexMinor,
      netOperatingResultMinor: grossProfit - opexMinor,
      taxCollectedMinor: s.taxMinor,
      byProduct: byProduct.map((p) => ({ productId: p._id.toString(), name: p.name, sku: p.sku, revenueMinor: p.revenueMinor, costMinor: p.costMinor, profitMinor: p.revenueMinor - p.costMinor, marginBps: p.revenueMinor > 0 ? Math.round(((p.revenueMinor - p.costMinor) / p.revenueMinor) * 10_000) : 0, units: p.units })),
      definitions: {
        netSales: 'grossSales − discounts − approved return refunds',
        cogs: 'Σ batch landed cost of units sold − cost of units returned to stock (write-offs stay in COGS)',
        grossProfit: 'netSales − cogs',
        netOperatingResult: 'grossProfit − approved operating expenses (excludes income tax, depreciation, financing)',
      },
    };
  }

  async inventoryValue(q: { groupBy?: string }) {
    const today = startOfDay(new Date());
    const rows = await this.batches.aggregate<{ _id: string; costValueMinor: number; retailValueMinor: number; units: number; batches: number }>([
      { $match: { onHandUnits: { $gt: 0 } } },
      { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product' } },
      { $unwind: '$product' },
      { $group: { _id: q.groupBy === 'status' ? '$status' : '$product.category', costValueMinor: { $sum: { $multiply: ['$onHandUnits', '$landedUnitCostMinor'] } }, retailValueMinor: { $sum: { $multiply: ['$onHandUnits', '$product.sellingPriceMinor'] } }, units: { $sum: '$onHandUnits' }, batches: { $sum: 1 } } },
      { $sort: { costValueMinor: -1 } },
    ]);
    const topProducts = await this.batches.aggregate<{ _id: Types.ObjectId; name: string; sku: string; costValueMinor: number; units: number }>([
      { $match: { onHandUnits: { $gt: 0 }, status: 'ACTIVE', expiryDate: { $gt: today } } },
      { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product' } },
      { $unwind: '$product' },
      { $group: { _id: '$productId', name: { $first: '$product.brandName' }, sku: { $first: '$product.sku' }, costValueMinor: { $sum: { $multiply: ['$onHandUnits', '$landedUnitCostMinor'] } }, units: { $sum: '$onHandUnits' } } },
      { $sort: { costValueMinor: -1 } },
      { $limit: 15 },
    ]);
    return {
      asOf: new Date(),
      totalCostValueMinor: rows.reduce((a, r) => a + r.costValueMinor, 0),
      totalRetailValueMinor: rows.reduce((a, r) => a + r.retailValueMinor, 0),
      groups: rows.map((r) => ({ key: r._id, ...r, _id: undefined })),
      topProductsByValue: topProducts.map((p) => ({ productId: p._id.toString(), name: p.name, sku: p.sku, costValueMinor: p.costValueMinor, units: p.units })),
      costingPolicy: 'BATCH_ACTUAL (each batch valued at its own landed unit cost)',
    };
  }

  async expiryLoss(q: DateRangeQuery) {
    const range = resolveRange(q, 90);
    const today = startOfDay(new Date());
    const [realized, expiredOnHand] = await Promise.all([
      // Realised: WRITE_OFF movements + purchase returns of expired stock in range
      this.movements.aggregate<{ _id: string; units: number; valueMinor: number; count: number }>([
        { $match: { createdAt: { $gte: range.from, $lte: range.to }, type: { $in: ['WRITE_OFF', 'PURCHASE_RETURN'] } } },
        { $group: { _id: '$type', units: { $sum: { $abs: '$quantityUnits' } }, valueMinor: { $sum: { $multiply: [{ $abs: '$quantityUnits' }, '$unitCostMinor'] } }, count: { $sum: 1 } } },
      ]),
      // Unrealised: stock that is already expired but still on hand
      this.batches.aggregate<{ _id: null; units: number; valueMinor: number; batches: number }>([
        { $match: { onHandUnits: { $gt: 0 }, expiryDate: { $lte: today } } },
        { $group: { _id: null, units: { $sum: '$onHandUnits' }, valueMinor: { $sum: { $multiply: ['$onHandUnits', '$landedUnitCostMinor'] } }, batches: { $sum: 1 } } },
      ]),
    ]);
    const expiredList = await this.batches.find({ onHandUnits: { $gt: 0 }, expiryDate: { $lte: today } }).populate('productId', 'brandName sku').sort({ expiryDate: 1 }).limit(50).lean();
    return {
      range,
      realized: realized.map((r) => ({ type: r._id, units: r.units, valueMinor: r.valueMinor, count: r.count })),
      realizedTotalMinor: realized.filter((r) => r._id === 'WRITE_OFF').reduce((a, r) => a + r.valueMinor, 0),
      recoveredViaSupplierMinor: realized.filter((r) => r._id === 'PURCHASE_RETURN').reduce((a, r) => a + r.valueMinor, 0),
      expiredOnHand: expiredOnHand[0] ? { units: expiredOnHand[0].units, valueMinor: expiredOnHand[0].valueMinor, batches: expiredOnHand[0].batches } : { units: 0, valueMinor: 0, batches: 0 },
      expiredBatches: expiredList.map((b) => ({ batchId: b._id.toString(), batchNumber: b.batchNumber, productName: (b.productId as unknown as { brandName: string }).brandName, sku: (b.productId as unknown as { sku: string }).sku, expiryDate: b.expiryDate, onHandUnits: b.onHandUnits, valueMinor: b.onHandUnits * b.landedUnitCostMinor, status: b.status })),
    };
  }

  async topProducts(q: DateRangeQuery) {
    const range = resolveRange(q);
    const rows = await this.sales.aggregate<{ _id: Types.ObjectId; name: string; sku: string; units: number; revenueMinor: number; count: number }>([
      { $match: { createdAt: { $gte: range.from, $lte: range.to }, status: { $ne: 'VOIDED' } } },
      { $unwind: '$lines' },
      { $group: { _id: '$lines.productId', name: { $first: '$lines.name' }, sku: { $first: '$lines.sku' }, units: { $sum: '$lines.quantityUnits' }, revenueMinor: { $sum: '$lines.lineTotalMinor' }, count: { $sum: 1 } } },
      { $sort: { revenueMinor: -1 } },
      { $limit: q.limit ?? 10 },
    ]);
    return rows.map((r) => ({ productId: r._id.toString(), name: r.name, sku: r.sku, units: r.units, revenueMinor: r.revenueMinor, saleCount: r.count }));
  }

  /** Products with stock but no sales in the window — ties up cash. */
  async slowMovers(q: DateRangeQuery) {
    const range = resolveRange(q, 60);
    const soldIds = await this.sales.distinct('lines.productId', { createdAt: { $gte: range.from, $lte: range.to } });
    const rows = await this.batches.aggregate<{ _id: Types.ObjectId; name: string; sku: string; units: number; costValueMinor: number; nearestExpiry: Date }>([
      { $match: { onHandUnits: { $gt: 0 }, status: 'ACTIVE', productId: { $nin: soldIds } } },
      { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product' } },
      { $unwind: '$product' },
      { $group: { _id: '$productId', name: { $first: '$product.brandName' }, sku: { $first: '$product.sku' }, units: { $sum: '$onHandUnits' }, costValueMinor: { $sum: { $multiply: ['$onHandUnits', '$landedUnitCostMinor'] } }, nearestExpiry: { $min: '$expiryDate' } } },
      { $sort: { costValueMinor: -1 } },
      { $limit: q.limit ?? 10 },
    ]);
    return { range, items: rows.map((r) => ({ productId: r._id.toString(), name: r.name, sku: r.sku, units: r.units, costValueMinor: r.costValueMinor, nearestExpiry: r.nearestExpiry })) };
  }

  /** Dashboard KPIs for "today" plus comparison with yesterday. */
  async dashboard() {
    const todayStart = startOfDay(new Date());
    const yesterdayStart = new Date(todayStart.getTime() - 86400_000);
    const [today, yesterday, inv, openSessions] = await Promise.all([
      this.grossProfit({ from: todayStart.toISOString(), to: new Date().toISOString() }),
      this.grossProfit({ from: yesterdayStart.toISOString(), to: new Date(todayStart.getTime() - 1).toISOString() }),
      this.inventoryValue({}),
      this.sessions.countDocuments({ status: 'OPEN' }),
    ]);
    return { today, yesterday, inventoryCostValueMinor: inv.totalCostValueMinor, openCashSessions: openSessions };
  }
}

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}
  @Get('dashboard') @RequirePermissions('reports.read') dashboard() {
    return this.service.dashboard();
  }
  @Get('sales') @RequirePermissions('reports.read') sales(@Query() q: DateRangeQuery) {
    return this.service.salesReport(q);
  }
  @Get('gross-profit') @RequirePermissions('reports.read') gp(@Query() q: DateRangeQuery) {
    return this.service.grossProfit(q);
  }
  @Get('inventory-value') @RequirePermissions('reports.read') inv(@Query() q: DateRangeQuery) {
    return this.service.inventoryValue(q);
  }
  @Get('expiry-loss') @RequirePermissions('reports.read') expiry(@Query() q: DateRangeQuery) {
    return this.service.expiryLoss(q);
  }
  @Get('top-products') @RequirePermissions('reports.read') top(@Query() q: DateRangeQuery) {
    return this.service.topProducts(q);
  }
  @Get('slow-movers') @RequirePermissions('reports.read') slow(@Query() q: DateRangeQuery) {
    return this.service.slowMovers(q);
  }
}

@Module({ controllers: [ReportsController], providers: [ReportsService], exports: [ReportsService] })
export class ReportsModule {}
