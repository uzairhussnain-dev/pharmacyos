import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { BatchStatus, MovementType } from '@pharmacy-os/shared-types';
import { ClientSession, Model, Types } from 'mongoose';
import { DomainError, ErrorCodes, NotFoundError } from '../../common/errors';
import { Batch, BatchDocument, isBatchEligible, startOfDay } from '../../database/schemas/batch.schema';
import { Product, ProductDocument } from '../../database/schemas/product.schema';
import { StockMovement, StockMovementDocument } from '../../database/schemas/stock-movement.schema';

export interface PostMovementInput {
  batchId: Types.ObjectId | string;
  type: MovementType;
  /** Signed base units. Negative = out. */
  quantityUnits: number;
  sourceType: string;
  sourceId?: Types.ObjectId | string;
  reason?: string;
  actorId: string | Types.ObjectId;
  requestId?: string;
  /** For inbound movements of a brand-new batch this is required; otherwise batch landed cost is used. */
  unitCostMinor?: number;
  /** When true, allows outbound even if the batch is not sellable (e.g. write-off of expired stock). */
  allowIneligible?: boolean;
}

export interface Allocation {
  batchId: Types.ObjectId;
  batchNumber: string;
  expiryDate: Date;
  quantityUnits: number;
  unitCostMinor: number;
}

/**
 * Pure FEFO allocator. Given eligible batches sorted by expiry ascending, allocates `needed` units.
 * Returns null when total available is insufficient (caller must abort — no partial sales).
 */
export function allocateFefo(
  batches: Pick<Batch, 'batchNumber' | 'expiryDate' | 'onHandUnits' | 'reservedUnits' | 'landedUnitCostMinor'>[] &
    { _id: Types.ObjectId }[],
  needed: number,
): Allocation[] | null {
  if (!Number.isInteger(needed) || needed <= 0) throw new TypeError('needed must be a positive integer');
  const sorted = [...batches].sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime() || a._id.toString().localeCompare(b._id.toString()));
  const out: Allocation[] = [];
  let remaining = needed;
  for (const b of sorted) {
    const free = b.onHandUnits - (b.reservedUnits ?? 0);
    if (free <= 0) continue;
    const take = Math.min(free, remaining);
    out.push({
      batchId: b._id,
      batchNumber: b.batchNumber,
      expiryDate: b.expiryDate,
      quantityUnits: take,
      unitCostMinor: b.landedUnitCostMinor,
    });
    remaining -= take;
    if (remaining === 0) break;
  }
  return remaining === 0 ? out : null;
}

@Injectable()
export class StockLedgerService {
  constructor(
    @InjectModel(Batch.name) private readonly batches: Model<BatchDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(StockMovement.name) private readonly movements: Model<StockMovementDocument>,
  ) {}

  /** Eligible (sellable) batches for a product, FEFO-ordered. */
  async eligibleBatches(productId: Types.ObjectId | string, session?: ClientSession) {
    const today = startOfDay(new Date());
    return this.batches
      .find({
        productId: new Types.ObjectId(productId),
        status: 'ACTIVE',
        expiryDate: { $gt: today },
        $expr: { $gt: [{ $subtract: ['$onHandUnits', '$reservedUnits'] }, 0] },
      })
      .sort({ expiryDate: 1, _id: 1 })
      .session(session ?? null);
  }

  /**
   * Posts a single ledger movement with a conditional atomic batch update.
   * For outbound movements the update only succeeds if the batch still has enough free units
   * AND is still eligible — this is what makes concurrent oversell impossible.
   */
  async postMovement(input: PostMovementInput, session: ClientSession): Promise<StockMovementDocument> {
    const qty = input.quantityUnits;
    if (!Number.isInteger(qty) || qty === 0) throw new TypeError('quantityUnits must be a non-zero integer');
    const batchId = new Types.ObjectId(input.batchId);

    const filter: Record<string, unknown> = { _id: batchId };
    if (qty < 0) {
      filter.$expr = { $gte: [{ $subtract: ['$onHandUnits', '$reservedUnits'] }, -qty] };
      if (!input.allowIneligible) {
        filter.status = 'ACTIVE';
        filter.expiryDate = { $gt: startOfDay(new Date()) };
      }
    }

    const updated = await this.batches.findOneAndUpdate(filter, { $inc: { onHandUnits: qty } }, { new: true, session });
    if (!updated) {
      const exists = await this.batches.findById(batchId).session(session).lean();
      if (!exists) throw new NotFoundError('Batch', batchId.toString());
      if (qty < 0 && !isBatchEligible(exists) && !input.allowIneligible) {
        throw new DomainError(ErrorCodes.BATCH_INELIGIBLE, `Batch ${exists.batchNumber} is not eligible for sale (${exists.status})`, {
          batchId: batchId.toString(),
          status: exists.status,
          expiryDate: exists.expiryDate,
        });
      }
      throw new DomainError(ErrorCodes.INSUFFICIENT_STOCK, `Insufficient stock in batch ${exists.batchNumber}`, {
        batchId: batchId.toString(),
        available: exists.onHandUnits - exists.reservedUnits,
        requested: -qty,
      });
    }

    // Auto-mark depleted batches (status is informational; eligibility is derived from onHand anyway).
    if (updated.onHandUnits === 0 && updated.status === 'ACTIVE' && qty < 0) {
      await this.batches.updateOne({ _id: batchId, onHandUnits: 0 }, { $set: { status: 'DEPLETED' } }, { session });
    } else if (updated.onHandUnits > 0 && updated.status === 'DEPLETED') {
      await this.batches.updateOne({ _id: batchId, status: 'DEPLETED' }, { $set: { status: 'ACTIVE' } }, { session });
    }

    const [movement] = await this.movements.create(
      [
        {
          productId: updated.productId,
          batchId,
          type: input.type,
          quantityUnits: qty,
          unitCostMinor: input.unitCostMinor ?? updated.landedUnitCostMinor,
          sourceType: input.sourceType,
          sourceId: input.sourceId ? new Types.ObjectId(input.sourceId) : undefined,
          reason: input.reason,
          actorId: new Types.ObjectId(input.actorId),
          requestId: input.requestId,
          balanceAfterUnits: updated.onHandUnits,
        },
      ],
      { session },
    );

    await this.refreshProductBalances(updated.productId, session);
    return movement;
  }

  /** Changes batch status (quarantine/release/recall) — no quantity change, but audited via movement row of 0? No: status changes are recorded in audit log by callers. */
  async setBatchStatus(batchId: string, status: BatchStatus, reason: string, session: ClientSession) {
    const batch = await this.batches.findByIdAndUpdate(batchId, { $set: { status, statusReason: reason } }, { new: true, session });
    if (!batch) throw new NotFoundError('Batch', batchId);
    await this.refreshProductBalances(batch.productId, session);
    return batch;
  }

  /** Recompute cached product balances from batches (cheap: one aggregate per product). */
  async refreshProductBalances(productId: Types.ObjectId, session?: ClientSession): Promise<void> {
    const today = startOfDay(new Date());
    const [agg] = await this.batches
      .aggregate<{ onHand: number; eligible: number }>([
        { $match: { productId } },
        {
          $group: {
            _id: null,
            onHand: { $sum: '$onHandUnits' },
            eligible: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$status', 'ACTIVE'] }, { $gt: ['$expiryDate', today] }] },
                  { $subtract: ['$onHandUnits', '$reservedUnits'] },
                  0,
                ],
              },
            },
          },
        },
      ])
      .session(session ?? null);
    await this.products.updateOne(
      { _id: productId },
      { $set: { onHandUnits: agg?.onHand ?? 0, eligibleUnits: agg?.eligible ?? 0 } },
      { session },
    );
  }
}
