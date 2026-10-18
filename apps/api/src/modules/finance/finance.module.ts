import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Model, Types } from 'mongoose';
import { RequirePermissions } from '../../common/decorators';
import { Customer, CustomerDocument } from '../../database/schemas/finance.schema';
import { GoodsReceipt, GoodsReceiptDocument } from '../../database/schemas/purchasing.schema';

@Injectable()
export class FinanceService {
  constructor(
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @InjectModel(GoodsReceipt.name) private readonly receipts: Model<GoodsReceiptDocument>,
  ) {}

  async receivables() {
    const items = await this.customers.find({ balanceMinor: { $gt: 0 } }).sort({ balanceMinor: -1 }).limit(100).lean();
    return {
      totalMinor: items.reduce((a, c) => a + c.balanceMinor, 0),
      count: items.length,
      items: items.map((c) => ({ customerId: c._id.toString(), name: c.name, phone: c.phone, balanceMinor: c.balanceMinor, creditLimitMinor: c.creditLimitMinor, utilizationBps: c.creditLimitMinor > 0 ? Math.round((c.balanceMinor / c.creditLimitMinor) * 10_000) : 0 })),
    };
  }

  async payables() {
    const rows = await this.receipts.aggregate<{ _id: Types.ObjectId; name: string; paymentTermsDays: number; outstandingMinor: number; receipts: number; oldest: Date }>([
      { $match: { status: 'ACCEPTED', $expr: { $gt: ['$totalCostMinor', '$paidMinor'] } } },
      { $lookup: { from: 'suppliers', localField: 'supplierId', foreignField: '_id', as: 'supplier' } },
      { $unwind: '$supplier' },
      { $group: { _id: '$supplierId', name: { $first: '$supplier.name' }, paymentTermsDays: { $first: '$supplier.paymentTermsDays' }, outstandingMinor: { $sum: { $subtract: ['$totalCostMinor', '$paidMinor'] } }, receipts: { $sum: 1 }, oldest: { $min: '$createdAt' } } },
      { $sort: { outstandingMinor: -1 } },
    ]);
    const now = Date.now();
    const open = await this.receipts.find({ status: 'ACCEPTED', $expr: { $gt: ['$totalCostMinor', '$paidMinor'] } }).populate('supplierId', 'name paymentTermsDays').sort({ createdAt: 1 }).limit(100).lean();
    return {
      totalMinor: rows.reduce((a, r) => a + r.outstandingMinor, 0),
      bySupplier: rows.map((r) => ({ supplierId: r._id.toString(), name: r.name, paymentTermsDays: r.paymentTermsDays, outstandingMinor: r.outstandingMinor, receipts: r.receipts, oldestReceiptAt: r.oldest })),
      openReceipts: open.map((g) => {
        const s = g.supplierId as unknown as { _id: Types.ObjectId; name: string; paymentTermsDays: number };
        const dueAt = new Date(g.createdAt.getTime() + (s.paymentTermsDays ?? 0) * 86400_000);
        return { receiptId: g._id.toString(), grnNumber: g.grnNumber, supplierId: s._id.toString(), supplierName: s.name, totalCostMinor: g.totalCostMinor, paidMinor: g.paidMinor, outstandingMinor: g.totalCostMinor - g.paidMinor, receivedAt: g.createdAt, dueAt, overdueDays: Math.max(0, Math.floor((now - dueAt.getTime()) / 86400_000)) };
      }),
    };
  }
}

@ApiTags('finance')
@ApiBearerAuth()
@Controller('finance')
export class FinanceController {
  constructor(private readonly service: FinanceService) {}
  @Get('receivables') @RequirePermissions('finance.read') receivables() {
    return this.service.receivables();
  }
  @Get('payables') @RequirePermissions('finance.read') payables() {
    return this.service.payables();
  }
}

@Module({ controllers: [FinanceController], providers: [FinanceService], exports: [FinanceService] })
export class FinanceModule {}
