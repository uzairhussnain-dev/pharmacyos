import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import type { Permission } from '@pharmacy-os/shared-types';
import { Model, Types } from 'mongoose';
import { AuthUser } from '../../common/decorators';
import { EnvConfig } from '../../config/env.config';
import { GoodsReceipt, GoodsReceiptDocument, PurchaseOrder, PurchaseOrderDocument } from '../../database/schemas/purchasing.schema';
import { RiskService } from '../inventory/risk.service';
import { ReportsService, resolveRange } from '../reports/reports.module';

export interface ToolResult {
  tool: string;
  title: string;
  range?: { from: Date; to: Date };
  definitions?: Record<string, string>;
  data: unknown;
  summary: string;
}

interface Tool {
  name: string;
  description: string;
  permission: Permission;
  patterns: RegExp[];
  run: (q: string, actor: AuthUser) => Promise<ToolResult>;
}

/**
 * Explainable assistant. The model (if configured) only:
 *   1. picks which approved tool(s) to call (we also have a keyword router as fallback), and
 *   2. narrates the tool results in plain language.
 * It never writes queries, never sees secrets, and never performs mutations.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly tools: Tool[];

  constructor(
    private readonly reports: ReportsService,
    private readonly risk: RiskService,
    private readonly config: ConfigService<EnvConfig, true>,
    @InjectModel(PurchaseOrder.name) private readonly pos: Model<PurchaseOrderDocument>,
    @InjectModel(GoodsReceipt.name) private readonly grns: Model<GoodsReceiptDocument>,
  ) {
    this.tools = [
      {
        name: 'gross_profit_change',
        description: 'Compare gross profit between this period and the previous one and explain drivers.',
        permission: 'reports.read',
        patterns: [/profit/i, /margin/i, /why.*(down|drop|decreas|fell|lower)/i],
        run: async (q) => {
          const days = /month/i.test(q) ? 30 : 7;
          const now = new Date();
          const cur = resolveRange({ from: new Date(now.getTime() - (days - 1) * 86400_000).toISOString().slice(0, 10) });
          const prev = { from: new Date(cur.from.getTime() - days * 86400_000), to: new Date(cur.from.getTime() - 1) };
          const [a, b] = await Promise.all([this.reports.grossProfit({ from: cur.from.toISOString(), to: cur.to.toISOString(), limit: 8 }), this.reports.grossProfit({ from: prev.from.toISOString(), to: prev.to.toISOString(), limit: 8 })]);
          const delta = a.grossProfitMinor - b.grossProfitMinor;
          const drivers: string[] = [];
          const pct = (x: number, y: number) => (y ? `${(((x - y) / Math.abs(y)) * 100).toFixed(1)}%` : 'n/a');
          drivers.push(`Net sales ${fmt(a.netSalesMinor)} vs ${fmt(b.netSalesMinor)} (${pct(a.netSalesMinor, b.netSalesMinor)})`);
          drivers.push(`COGS ${fmt(a.cogsMinor)} vs ${fmt(b.cogsMinor)} (${pct(a.cogsMinor, b.cogsMinor)})`);
          drivers.push(`Discounts ${fmt(a.discountsMinor)} vs ${fmt(b.discountsMinor)}`);
          drivers.push(`Returns ${fmt(a.returnsMinor)} vs ${fmt(b.returnsMinor)}`);
          drivers.push(`Gross margin ${(a.grossMarginBps / 100).toFixed(1)}% vs ${(b.grossMarginBps / 100).toFixed(1)}%`);
          return {
            tool: 'gross_profit_change',
            title: `Gross profit: last ${days} days vs previous ${days} days`,
            range: cur,
            definitions: a.definitions,
            data: { current: a, previous: b, deltaMinor: delta },
            summary: `Gross profit ${delta >= 0 ? 'rose' : 'fell'} by ${fmt(Math.abs(delta))} (${fmt(a.grossProfitMinor)} vs ${fmt(b.grossProfitMinor)}). ${drivers.join('; ')}. Top contributors this period: ${a.byProduct.slice(0, 3).map((p) => `${p.name} ${fmt(p.profitMinor)}`).join(', ') || 'none'}.`,
          };
        },
      },
      {
        name: 'stockout_risk',
        description: 'Products at risk of running out, with days of cover and reorder suggestions.',
        permission: 'inventory.read',
        patterns: [/run(ning)? out/i, /stock ?out/i, /low stock/i, /reorder/i, /out of stock/i],
        run: async () => {
          const items = (await this.risk.stockoutRisk()).slice(0, 15);
          return {
            tool: 'stockout_risk',
            title: 'Stockout risk (rules-v1: 30-day moving average, 90% service level)',
            definitions: { daysOfCover: 'eligible units ÷ average daily demand (30-day window)', reorderPoint: 'max(reorder level, demand × lead time + 1.28·σ·√lead time)', suggestedReorder: 'demand × (lead + 14 days) + safety − stock − on order' },
            data: items,
            summary: items.length
              ? `${items.length} products need attention. ${items.slice(0, 5).map((i) => `${i.productName}: ${i.eligibleUnits} ${i.baseUnit}${i.daysOfCover !== null ? ` (~${Math.round(i.daysOfCover)} days)` : ''}${i.demandReliable ? '' : ' [limited history]'}`).join('; ')}.`
              : 'No products are currently below their reorder point.',
          };
        },
      },
      {
        name: 'expiry_risk',
        description: 'Batches at risk of expiring unsold, with cost exposure.',
        permission: 'inventory.read',
        patterns: [/expir/i, /batch/i, /attention/i, /shelf life/i],
        run: async () => {
          const items = (await this.risk.expiryRisk(120)).filter((i) => i.projectedUnsoldUnits > 0).slice(0, 15);
          const exposure = items.reduce((a, i) => a + i.projectedLossMinor, 0);
          return {
            tool: 'expiry_risk',
            title: 'Batches expiring within 120 days with projected unsold units',
            definitions: { projectedUnsold: 'on-hand − min(on-hand, avg daily demand × days to expiry), with earlier batches consuming demand first (FEFO)', projectedLoss: 'projected unsold × landed unit cost' },
            data: items,
            summary: items.length ? `${items.length} batches, projected loss ${fmt(exposure)} at cost. Most urgent: ${items.slice(0, 4).map((i) => `${i.productName} ${i.batchNumber} (${i.daysToExpiry}d, ${i.projectedUnsoldUnits} unsold)`).join('; ')}.` : 'No batches are projected to expire with unsold stock in the next 120 days.',
          };
        },
      },
      {
        name: 'inventory_cash',
        description: 'Which products tie up the most inventory cash; slow movers.',
        permission: 'reports.read',
        patterns: [/tie|tied|tying/i, /cash/i, /inventory value/i, /slow/i, /dead stock/i],
        run: async () => {
          const [inv, slow] = await Promise.all([this.reports.inventoryValue({}), this.reports.slowMovers({ limit: 10 })]);
          return {
            tool: 'inventory_cash',
            title: 'Inventory cash exposure',
            range: slow.range,
            definitions: { costValue: 'Σ on-hand units × batch landed unit cost', slowMover: 'has stock but zero sales in the last 60 days' },
            data: { totalCostValueMinor: inv.totalCostValueMinor, topProductsByValue: inv.topProductsByValue, slowMovers: slow.items },
            summary: `Total inventory at cost ${fmt(inv.totalCostValueMinor)}. Largest holdings: ${inv.topProductsByValue.slice(0, 5).map((p) => `${p.name} ${fmt(p.costValueMinor)}`).join(', ')}. ${slow.items.length ? `Slow movers (no sales in 60 days): ${slow.items.slice(0, 4).map((s) => `${s.name} ${fmt(s.costValueMinor)}`).join(', ')}.` : 'No slow movers detected.'}`,
          };
        },
      },
      {
        name: 'supplier_lateness',
        description: 'Suppliers whose deliveries are repeatedly late.',
        permission: 'purchasing.read',
        patterns: [/supplier/i, /late/i, /deliver/i, /vendor/i],
        run: async () => {
          const rows = await this.pos.aggregate<{ _id: Types.ObjectId; name: string; orders: number; late: number; avgLateDays: number }>([
            { $match: { status: { $in: ['RECEIVED', 'PARTIALLY_RECEIVED', 'SUBMITTED'] }, expectedDeliveryDate: { $ne: null } } },
            { $lookup: { from: 'goods_receipts', localField: '_id', foreignField: 'purchaseOrderId', as: 'grn' } },
            { $addFields: { firstReceipt: { $min: '$grn.createdAt' } } },
            { $addFields: { lateDays: { $divide: [{ $subtract: [{ $ifNull: ['$firstReceipt', '$$NOW'] }, '$expectedDeliveryDate'] }, 86400000] } } },
            { $lookup: { from: 'suppliers', localField: 'supplierId', foreignField: '_id', as: 's' } },
            { $group: { _id: '$supplierId', name: { $first: { $arrayElemAt: ['$s.name', 0] } }, orders: { $sum: 1 }, late: { $sum: { $cond: [{ $gt: ['$lateDays', 0.5] }, 1, 0] } }, avgLateDays: { $avg: { $max: ['$lateDays', 0] } } } },
            { $match: { late: { $gte: 1 } } },
            { $sort: { late: -1, avgLateDays: -1 } },
            { $limit: 10 },
          ]);
          return {
            tool: 'supplier_lateness',
            title: 'Supplier delivery punctuality (all orders with an expected date)',
            definitions: { late: 'first goods receipt (or today if none) after expected delivery date', avgLateDays: 'mean days late across orders, floored at 0' },
            data: rows,
            summary: rows.length ? rows.slice(0, 5).map((r) => `${r.name}: ${r.late}/${r.orders} orders late, avg ${r.avgLateDays.toFixed(1)} days`).join('; ') : 'No late deliveries recorded.',
          };
        },
      },
      {
        name: 'sales_overview',
        description: 'Sales totals, trend and payment mix for a period.',
        permission: 'reports.read',
        patterns: [/sales/i, /revenue/i, /sold/i, /best.?sell/i, /top product/i],
        run: async (q) => {
          const days = /month/i.test(q) ? 30 : /today/i.test(q) ? 1 : 7;
          const from = new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10);
          const [rep, top] = await Promise.all([this.reports.salesReport({ from }), this.reports.topProducts({ from, limit: 5 })]);
          return {
            tool: 'sales_overview',
            title: `Sales — last ${days} day${days === 1 ? '' : 's'}`,
            range: rep.range,
            data: { totals: rep.totals, paymentMethods: rep.paymentMethods, topProducts: top },
            summary: `${rep.totals.count} sales totalling ${fmt(rep.totals.totalMinor)} (avg basket ${fmt(rep.totals.avgBasketMinor)}). Payment mix: ${rep.paymentMethods.map((m) => `${m.method} ${fmt(m.amountMinor)}`).join(', ') || 'none'}. Best sellers: ${top.map((t) => `${t.name} (${t.units})`).join(', ') || 'none'}.`,
          };
        },
      },
    ];
  }

  listTools(actor: AuthUser) {
    return this.tools.filter((t) => actor.permissions.includes(t.permission)).map((t) => ({ name: t.name, description: t.description }));
  }

  async query(question: string, actor: AuthUser) {
    const q = question.trim().slice(0, 500);
    const allowed = this.tools.filter((t) => actor.permissions.includes(t.permission));
    let selected = allowed.filter((t) => t.patterns.some((p) => p.test(q)));
    if (!selected.length) selected = allowed.filter((t) => t.name === 'sales_overview');
    selected = selected.slice(0, 2);

    const results: ToolResult[] = [];
    for (const t of selected) {
      try {
        results.push(await t.run(q, actor));
      } catch (e) {
        this.logger.warn(`tool ${t.name} failed: ${(e as Error).message}`);
      }
    }
    const denied = this.tools.filter((t) => !actor.permissions.includes(t.permission) && t.patterns.some((p) => p.test(q))).map((t) => t.name);

    const grounded = results.map((r) => `${r.title}: ${r.summary}`).join('\n\n');
    const narrative = await this.narrate(q, results).catch(() => null);
    return {
      question: q,
      answer: narrative ?? grounded ?? 'I could not find an approved report that answers that question.',
      narrativeSource: narrative ? 'llm' : 'rules',
      tools: results,
      deniedTools: denied,
      generatedAt: new Date(),
      disclaimer: 'Figures come directly from recorded transactions via approved reporting tools. The assistant cannot change stock, prices, payments or medicine decisions.',
    };
  }

  /** Optional LLM narration. Only summaries/definitions are sent — never raw records, credentials or PII. */
  private async narrate(question: string, results: ToolResult[]): Promise<string | null> {
    const key = this.config.get('OPENAI_API_KEY', { infer: true });
    if (!key || !results.length) return null;
    const model = this.config.get('OPENAI_MODEL', { infer: true }) || 'gpt-4o-mini';
    const context = results.map((r) => ({ title: r.title, summary: r.summary, definitions: r.definitions, range: r.range })).slice(0, 2);
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 350,
        messages: [
          { role: 'system', content: 'You are a pharmacy business analyst. Answer ONLY from the provided tool summaries. Do not invent numbers. Be concise (max 120 words), mention the date range, and never give medical or dispensing advice.' },
          { role: 'user', content: `Question: ${question}\n\nTool results:\n${JSON.stringify(context)}` },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content?.trim() ?? null;
  }
}

function fmt(minor: number): string {
  return `Rs ${(minor / 100).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
