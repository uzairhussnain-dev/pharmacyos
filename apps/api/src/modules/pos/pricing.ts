import { allocateProportionally, applyBps, multiply, roundHalfUp, sum } from '../../common/money/money';
import { DomainError, ErrorCodes } from '../../common/errors';
import type { Product } from '../../database/schemas/product.schema';

export interface PricedLine {
  productId: string;
  sku: string;
  name: string;
  unitName: string;
  unitMultiplier: number;
  quantity: number;
  quantityUnits: number;
  unitPriceMinor: number;
  grossMinor: number;
  discountMinor: number;
  taxRateBps: number;
  taxMinor: number;
  lineTotalMinor: number;
  requiresPrescription: boolean;
  saleRestriction: Product['saleRestriction'];
  prescriptionVerified: boolean;
}

export interface PricedCart {
  lines: PricedLine[];
  subtotalMinor: number; // sum of gross
  lineDiscountMinor: number;
  orderDiscountMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export interface PricingPolicy {
  /** Max total discount as bps of subtotal the actor may apply without pos.discount permission. */
  maxDiscountBps: number;
  canDiscount: boolean;
  requirePrescriptionConfirmation: boolean;
  blockControlled: boolean;
}

/** Resolve the unit (base or pack) a cart line refers to. */
export function resolveUnit(product: Pick<Product, 'baseUnit' | 'packUnits' | 'sellingPriceMinor'>, unitName?: string) {
  if (!unitName || unitName === product.baseUnit) {
    return { unitName: product.baseUnit, multiplier: 1, unitPriceMinor: product.sellingPriceMinor };
  }
  const pack = product.packUnits.find((u) => u.name.toLowerCase() === unitName.toLowerCase());
  if (!pack) throw new DomainError(ErrorCodes.VALIDATION_FAILED, `Unknown unit "${unitName}"`);
  return {
    unitName: pack.name,
    multiplier: pack.multiplier,
    unitPriceMinor: pack.sellingPriceMinor ?? multiply(product.sellingPriceMinor, pack.multiplier),
  };
}

/**
 * Pure, server-authoritative pricing. Never trusts client totals.
 * Tax is computed per line on (gross - discount). Order-level discount is allocated across
 * lines proportionally to their net (so COGS/returns line up) and tax is recomputed after.
 */
export function priceCart(
  input: { lines: { product: Product & { _id: { toString(): string } }; unitName?: string; quantity: number; discountMinor?: number; prescriptionVerified?: boolean }[]; orderDiscountMinor?: number },
  policy: PricingPolicy,
): PricedCart {
  if (!input.lines.length) throw new DomainError(ErrorCodes.VALIDATION_FAILED, 'Cart is empty');

  const draft = input.lines.map((l) => {
    const p = l.product;
    if (!p.isActive) throw new DomainError(ErrorCodes.PRODUCT_INACTIVE, `${p.brandName} is inactive`);
    if (policy.blockControlled && p.saleRestriction === 'CONTROLLED') {
      throw new DomainError(ErrorCodes.RESTRICTED_SALE, `${p.brandName} is a controlled item and cannot be sold at POS`);
    }
    if (policy.requirePrescriptionConfirmation && p.requiresPrescription && !l.prescriptionVerified) {
      throw new DomainError(ErrorCodes.RESTRICTED_SALE, `${p.brandName} requires a prescription — confirm it was checked`, { productId: p._id.toString() });
    }
    const unit = resolveUnit(p, l.unitName);
    const gross = multiply(unit.unitPriceMinor, l.quantity);
    const discount = l.discountMinor ?? 0;
    if (discount > gross) throw new DomainError(ErrorCodes.DISCOUNT_NOT_ALLOWED, `Discount exceeds line value for ${p.brandName}`);
    return { p, unit, gross, discount, quantity: l.quantity, prescriptionVerified: Boolean(l.prescriptionVerified) };
  });

  const subtotal = sum(draft.map((d) => d.gross));
  const lineDiscount = sum(draft.map((d) => d.discount));
  const orderDiscount = input.orderDiscountMinor ?? 0;
  if (orderDiscount > subtotal - lineDiscount) throw new DomainError(ErrorCodes.DISCOUNT_NOT_ALLOWED, 'Order discount exceeds cart value');
  const totalDiscount = lineDiscount + orderDiscount;
  if (totalDiscount > 0) {
    if (!policy.canDiscount) throw new DomainError(ErrorCodes.DISCOUNT_NOT_ALLOWED, 'You are not permitted to apply discounts');
    const cap = applyBps(subtotal, policy.maxDiscountBps);
    if (totalDiscount > cap) {
      throw new DomainError(ErrorCodes.DISCOUNT_NOT_ALLOWED, `Total discount exceeds the allowed maximum (${policy.maxDiscountBps / 100}%)`, { capMinor: cap });
    }
  }

  const nets = draft.map((d) => d.gross - d.discount);
  const allocatedOrderDiscount = allocateProportionally(orderDiscount, nets);

  const lines: PricedLine[] = draft.map((d, i) => {
    const discount = d.discount + allocatedOrderDiscount[i];
    const net = d.gross - discount;
    const tax = applyBps(net, d.p.taxRateBps);
    return {
      productId: d.p._id.toString(),
      sku: d.p.sku,
      name: `${d.p.brandName}${d.p.strength ? ' ' + d.p.strength : ''}`,
      unitName: d.unit.unitName,
      unitMultiplier: d.unit.multiplier,
      quantity: d.quantity,
      quantityUnits: d.quantity * d.unit.multiplier,
      unitPriceMinor: d.unit.unitPriceMinor,
      grossMinor: d.gross,
      discountMinor: discount,
      taxRateBps: d.p.taxRateBps,
      taxMinor: tax,
      lineTotalMinor: net + tax,
      requiresPrescription: d.p.requiresPrescription,
      saleRestriction: d.p.saleRestriction,
      prescriptionVerified: d.prescriptionVerified,
    };
  });

  const taxMinor = sum(lines.map((l) => l.taxMinor));
  return {
    lines,
    subtotalMinor: subtotal,
    lineDiscountMinor: lineDiscount,
    orderDiscountMinor: orderDiscount,
    discountMinor: totalDiscount,
    taxMinor,
    totalMinor: roundHalfUp(subtotal - totalDiscount + taxMinor),
  };
}

/** Validates tenders against total; returns paid/change. CREDIT counts as payment only with a customer. */
export function settleTenders(totalMinor: number, tenders: { method: string; amountMinor: number }[], hasCustomer: boolean) {
  const paid = sum(tenders.map((t) => t.amountMinor));
  const nonCash = sum(tenders.filter((t) => t.method !== 'CASH').map((t) => t.amountMinor));
  const credit = sum(tenders.filter((t) => t.method === 'CREDIT').map((t) => t.amountMinor));
  if (credit > 0 && !hasCustomer) throw new DomainError(ErrorCodes.PAYMENT_MISMATCH, 'Credit sales require a customer');
  if (paid < totalMinor) throw new DomainError(ErrorCodes.PAYMENT_MISMATCH, `Tendered ${paid} is less than total ${totalMinor}`, { shortfallMinor: totalMinor - paid });
  // Change can only be given from cash. Non-cash must not exceed total.
  if (nonCash > totalMinor) throw new DomainError(ErrorCodes.PAYMENT_MISMATCH, 'Non-cash payments exceed the sale total');
  const change = paid - totalMinor;
  const cashTendered = paid - nonCash;
  const cashKept = cashTendered - change;
  return { paidMinor: totalMinor, changeMinor: change, cashKeptMinor: cashKept, creditMinor: credit };
}
