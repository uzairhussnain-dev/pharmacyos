import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Batch, BatchDocument, startOfDay } from '../../database/schemas/batch.schema';
import { Product, ProductDocument } from '../../database/schemas/product.schema';
import { PurchaseOrder, PurchaseOrderDocument } from '../../database/schemas/purchasing.schema';
import { Sale, SaleDocument } from '../../database/schemas/sales.schema';
import { Supplier, SupplierDocument } from '../../database/schemas/purchasing.schema';

export const FORECAST_MODEL_VERSION = 'rules-v1-ma30';
const LOOKBACK_DAYS = 30;
const MIN_OBSERVATION_DAYS = 14;
const MIN_SALES_EVENTS = 3;
/** Safety factor ~ 1.28 ≈ 90% service level under a normal approximation. */
const SAFETY_Z = 1.28;

export interface DemandStats {
  productId: string;
  avgDailyUnits: number;
  stdDevDailyUnits: number;
  totalUnits: number;
  saleEvents: number;
  observationDays: number;
  isReliable: boolean;
}

export interface ExpiryRiskItem {
  batchId: string;
  batchNumber: string;
  productId: string;
  productName: string;
  sku: string;
  baseUnit: string;
  expiryDate: Date;
  daysToExpiry: number;
  onHandUnits: number;
  unitCostMinor: number;
  costExposureMinor: number;
  avgDailyDemandUnits: number;
  projectedSellThroughUnits: number;
  projectedUnsoldUnits: number;
  projectedLossMinor: number;
  demandReliable: boolean;
  supplierAcceptsReturns: boolean;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface StockoutRiskItem {
  productId: string;
  productName: string;
  sku: string;
  baseUnit: string;
  eligibleUnits: number;
  pendingOrderUnits: number;
  avgDailyDemandUnits: number;
  stdDevDailyUnits: number;
  leadTimeDays: number;
  daysOfCover: number | null;
  projectedStockoutDate: Date | null;
  reorderPointUnits: number;
  suggestedReorderUnits: number;
  demandReliable: boolean;
  observationDays: number;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

@Injectable()
export class RiskService {
  constructor(
    @InjectModel(Batch.name) private readonly batches: Model<BatchDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Sale.name) private readonly sales: Model<SaleDocument>,
    @InjectModel(PurchaseOrder.name) private readonly pos: Model<PurchaseOrderDocument>,
    @InjectModel(Supplier.name) private readonly suppliers: Model<SupplierDocument>,
  ) {}

  /**
   * Per-product demand over the lookback window: mean and std-dev of DAILY net units sold
   * (sales minus returned units), with zero-filled days. Returns a map productId -> stats.
   */
  async demandStats(productIds?: Types.ObjectId[], lookbackDays = LOOKBACK_DAYS): Promise<Map<string, DemandStats>> {
    const since = startOfDay(new Date(Date.now() - lookbackDays * 86400_000));
    const match: Record<string, unknown> = { createdAt: { $gte: since }, status: { $ne: 'VOIDED' } };
    const rows = await this.sales.aggregate<{ _id: { productId: Types.ObjectId; day: string }; units: number; events: number }>([
      { $match: match },
      { $unwind: '$lines' },
      ...(productIds ? [{ $match: { 'lines.productId': { $in: productIds } } }] : []),
      {
        $group: {
          _id: { productId: '$lines.productId', day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } },
          units: { $sum: { $subtract: ['$lines.quantityUnits', '$lines.returnedUnits'] } },
          events: { $sum: 1 },
        },
      },
    ]);
    // Observation window is bounded by the earliest sale in the system (so a 5-day-old shop isn't treated as 30 days of zeros).
    const first = await this.sales.findOne({}, { createdAt: 1 }).sort({ createdAt: 1 }).lean();
    const observationDays = first
      ? Math.max(1, Math.min(lookbackDays, Math.ceil((Date.now() - first.createdAt.getTime()) / 86400_000)))
      : 0;

    const byProduct = new Map<string, { daily: Map<string, number>; events: number }>();
    for (const r of rows) {
      const key = r._id.productId.toString();
      const entry = byProduct.get(key) ?? { daily: new Map<string, number>(), events: 0 };
      entry.daily.set(r._id.day, (entry.daily.get(r._id.day) ?? 0) + r.units);
      entry.events += r.events;
      byProduct.set(key, entry);
    }
    const out = new Map<string, DemandStats>();
    const ids = productIds?.map(String) ?? [...byProduct.keys()];
    for (const id of ids) {
      const entry = byProduct.get(id);
      const values: number[] = [];
      for (let i = 0; i < observationDays; i++) {
        const day = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
        values.push(entry?.daily.get(day) ?? 0);
      }
      const total = values.reduce((a, b) => a + b, 0);
      const avg = observationDays ? total / observationDays : 0;
      const variance = observationDays ? values.reduce((a, v) => a + (v - avg) ** 2, 0) / observationDays : 0;
      out.set(id, {
        productId: id,
        avgDailyUnits: avg,
        stdDevDailyUnits: Math.sqrt(variance),
        totalUnits: total,
        saleEvents: entry?.events ?? 0,
        observationDays,
        isReliable: observationDays >= MIN_OBSERVATION_DAYS && (entry?.events ?? 0) >= MIN_SALES_EVENTS,
      });
    }
    return out;
  }

  async expiryRisk(withinDays = 180): Promise<ExpiryRiskItem[]> {
    const today = startOfDay(new Date());
    const horizon = new Date(today.getTime() + withinDays * 86400_000);
    const batches = await this.batches
      .find({ onHandUnits: { $gt: 0 }, status: { $in: ['ACTIVE', 'QUARANTINED'] }, expiryDate: { $lte: horizon } })
      .populate('productId', 'brandName sku baseUnit strength')
      .populate('supplierId', 'acceptsExpiryReturns')
      .sort({ expiryDate: 1 })
      .lean();
    const productIds = [...new Set(batches.map((b) => (b.productId as unknown as { _id: Types.ObjectId })._id.toString()))].map(
      (s) => new Types.ObjectId(s),
    );
    const demand = await this.demandStats(productIds);
    // Earlier-expiring batches of the same product consume demand first (FEFO), so compute per product.
    const demandConsumed = new Map<string, number>();

    return batches.map((b) => {
      const p = b.productId as unknown as { _id: Types.ObjectId; brandName: string; sku: string; baseUnit: string; strength?: string };
      const pid = p._id.toString();
      const stats = demand.get(pid);
      const daysToExpiry = Math.max(0, Math.ceil((b.expiryDate.getTime() - today.getTime()) / 86400_000));
      const avg = stats?.avgDailyUnits ?? 0;
      const alreadyConsumed = demandConsumed.get(pid) ?? 0;
      const demandBeforeExpiry = Math.max(0, Math.floor(avg * daysToExpiry) - alreadyConsumed);
      const sellThrough = b.status === 'ACTIVE' ? Math.min(b.onHandUnits, demandBeforeExpiry) : 0;
      demandConsumed.set(pid, alreadyConsumed + sellThrough);
      const unsold = b.onHandUnits - sellThrough;
      const exposure = b.onHandUnits * b.landedUnitCostMinor;
      const loss = unsold * b.landedUnitCostMinor;
      const severity: ExpiryRiskItem['severity'] =
        daysToExpiry <= 0 || (daysToExpiry <= 30 && unsold > 0)
          ? 'CRITICAL'
          : daysToExpiry <= 60 && unsold > 0
            ? 'HIGH'
            : daysToExpiry <= 90 && unsold > 0
              ? 'MEDIUM'
              : 'LOW';
      return {
        batchId: b._id.toString(),
        batchNumber: b.batchNumber,
        productId: pid,
        productName: `${p.brandName}${p.strength ? ' ' + p.strength : ''}`,
        sku: p.sku,
        baseUnit: p.baseUnit,
        expiryDate: b.expiryDate,
        daysToExpiry,
        onHandUnits: b.onHandUnits,
        unitCostMinor: b.landedUnitCostMinor,
        costExposureMinor: exposure,
        avgDailyDemandUnits: round2(avg),
        projectedSellThroughUnits: sellThrough,
        projectedUnsoldUnits: unsold,
        projectedLossMinor: loss,
        demandReliable: stats?.isReliable ?? false,
        supplierAcceptsReturns: Boolean((b.supplierId as unknown as { acceptsExpiryReturns?: boolean })?.acceptsExpiryReturns),
        severity,
      };
    });
  }

  async stockoutRisk(): Promise<StockoutRiskItem[]> {
    const products = await this.products.find({ isActive: true }).lean();
    const demand = await this.demandStats(products.map((p) => p._id));
    const pending = await this.pos.aggregate<{ _id: Types.ObjectId; units: number }>([
      { $match: { status: { $in: ['SUBMITTED', 'PARTIALLY_RECEIVED'] } } },
      { $unwind: '$lines' },
      { $group: { _id: '$lines.productId', units: { $sum: { $subtract: ['$lines.quantityUnits', '$lines.receivedUnits'] } } } },
    ]);
    const pendingMap = new Map(pending.map((p) => [p._id.toString(), p.units]));

    const items: StockoutRiskItem[] = [];
    for (const p of products) {
      const stats = demand.get(p._id.toString());
      const avg = stats?.avgDailyUnits ?? 0;
      const sd = stats?.stdDevDailyUnits ?? 0;
      const lead = p.leadTimeDays || 7;
      const pendingUnits = pendingMap.get(p._id.toString()) ?? 0;
      const daysOfCover = avg > 0 ? p.eligibleUnits / avg : null;
      const safetyStock = Math.ceil(SAFETY_Z * sd * Math.sqrt(lead));
      const reorderPoint = Math.max(p.reorderLevel, Math.ceil(avg * lead) + safetyStock);
      const targetCover = Math.ceil(avg * (lead + 14)) + safetyStock; // cover lead time + 2 weeks
      const suggested = Math.max(0, targetCover - p.eligibleUnits - pendingUnits);
      const belowReorder = p.eligibleUnits <= reorderPoint;
      const projectedStockoutDate = daysOfCover !== null ? new Date(Date.now() + daysOfCover * 86400_000) : null;

      let severity: StockoutRiskItem['severity'] = 'LOW';
      if (p.eligibleUnits <= 0 && (avg > 0 || p.reorderLevel > 0)) severity = 'CRITICAL';
      else if (daysOfCover !== null && daysOfCover <= lead) severity = 'HIGH';
      else if (belowReorder && (p.reorderLevel > 0 || avg > 0)) severity = 'MEDIUM';

      if (severity === 'LOW') continue;
      items.push({
        productId: p._id.toString(),
        productName: `${p.brandName}${p.strength ? ' ' + p.strength : ''}`,
        sku: p.sku,
        baseUnit: p.baseUnit,
        eligibleUnits: p.eligibleUnits,
        pendingOrderUnits: pendingUnits,
        avgDailyDemandUnits: round2(avg),
        stdDevDailyUnits: round2(sd),
        leadTimeDays: lead,
        daysOfCover: daysOfCover === null ? null : round2(daysOfCover),
        projectedStockoutDate,
        reorderPointUnits: reorderPoint,
        suggestedReorderUnits: Math.max(suggested, p.reorderQuantity > 0 && suggested > 0 ? p.reorderQuantity : 0),
        demandReliable: stats?.isReliable ?? false,
        observationDays: stats?.observationDays ?? 0,
        severity,
      });
    }
    const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return items.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.daysOfCover ?? 1e9) - (b.daysOfCover ?? 1e9));
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
