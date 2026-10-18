import { Types } from 'mongoose';
import type { Product } from '../../database/schemas/product.schema';
import { priceCart, resolveUnit, settleTenders } from './pricing';

const product = (over: Partial<Product> = {}): Product & { _id: Types.ObjectId } =>
  ({
    _id: new Types.ObjectId(),
    sku: 'PAN500',
    brandName: 'Panadol',
    genericName: 'Paracetamol',
    strength: '500mg',
    dosageForm: 'Tablet',
    category: 'Analgesic',
    baseUnit: 'Tablet',
    packUnits: [{ name: 'Strip', multiplier: 10 }, { name: 'Box', multiplier: 100, sellingPriceMinor: 14000 }],
    sellingPriceMinor: 150,
    taxClass: 'STANDARD',
    taxRateBps: 0,
    saleRestriction: 'OTC',
    requiresPrescription: false,
    isActive: true,
    tracksExpiry: true,
    reorderLevel: 0,
    reorderQuantity: 0,
    leadTimeDays: 7,
    onHandUnits: 0,
    eligibleUnits: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as never;

const policy = { maxDiscountBps: 2000, canDiscount: true, requirePrescriptionConfirmation: true, blockControlled: false };

describe('resolveUnit (pack conversion)', () => {
  const p = product();
  it('defaults to base unit', () => {
    expect(resolveUnit(p)).toEqual({ unitName: 'Tablet', multiplier: 1, unitPriceMinor: 150 });
  });
  it('derives pack price from base price when not explicit', () => {
    expect(resolveUnit(p, 'Strip')).toEqual({ unitName: 'Strip', multiplier: 10, unitPriceMinor: 1500 });
  });
  it('uses explicit pack price when provided', () => {
    expect(resolveUnit(p, 'box').unitPriceMinor).toBe(14000);
  });
  it('rejects unknown unit', () => {
    expect(() => resolveUnit(p, 'Pallet')).toThrow(/Unknown unit/);
  });
});

describe('priceCart', () => {
  it('prices base and pack lines and converts to base units', () => {
    const p = product();
    const cart = priceCart({ lines: [{ product: p, quantity: 3 }, { product: p, unitName: 'Strip', quantity: 2 }] }, policy);
    expect(cart.lines[0].quantityUnits).toBe(3);
    expect(cart.lines[1].quantityUnits).toBe(20);
    expect(cart.subtotalMinor).toBe(450 + 3000);
    expect(cart.totalMinor).toBe(3450);
  });

  it('applies tax per line after discount', () => {
    const p = product({ taxRateBps: 1700, sellingPriceMinor: 1000 });
    const cart = priceCart({ lines: [{ product: p, quantity: 1, discountMinor: 100 }] }, policy);
    expect(cart.lines[0].taxMinor).toBe(153); // 17% of 900
    expect(cart.totalMinor).toBe(1053);
  });

  it('allocates order discount proportionally and preserves totals', () => {
    const a = product({ sellingPriceMinor: 1000 });
    const b = product({ sellingPriceMinor: 2000, sku: 'B' });
    const cart = priceCart({ lines: [{ product: a, quantity: 1 }, { product: b, quantity: 1 }], orderDiscountMinor: 301 }, policy);
    expect(cart.lines.map((l) => l.discountMinor)).toEqual([100, 201]); // largest-remainder rounding
    expect(cart.totalMinor).toBe(3000 - 301);
  });

  it('enforces discount permission and cap', () => {
    const p = product({ sellingPriceMinor: 1000 });
    expect(() => priceCart({ lines: [{ product: p, quantity: 1, discountMinor: 50 }] }, { ...policy, canDiscount: false })).toThrow(/not permitted/);
    expect(() => priceCart({ lines: [{ product: p, quantity: 1, discountMinor: 250 }] }, policy)).toThrow(/exceeds the allowed maximum/);
    expect(() => priceCart({ lines: [{ product: p, quantity: 1, discountMinor: 1200 }] }, policy)).toThrow(/exceeds line value/);
  });

  it('blocks inactive products and unconfirmed prescriptions', () => {
    expect(() => priceCart({ lines: [{ product: product({ isActive: false }), quantity: 1 }] }, policy)).toThrow(/inactive/);
    const rx = product({ requiresPrescription: true, saleRestriction: 'PRESCRIPTION' });
    expect(() => priceCart({ lines: [{ product: rx, quantity: 1 }] }, policy)).toThrow(/requires a prescription/);
    expect(priceCart({ lines: [{ product: rx, quantity: 1, prescriptionVerified: true }] }, policy).totalMinor).toBe(150);
    expect(priceCart({ lines: [{ product: rx, quantity: 1 }] }, { ...policy, requirePrescriptionConfirmation: false }).totalMinor).toBe(150);
  });

  it('blocks controlled items when configured', () => {
    const c = product({ saleRestriction: 'CONTROLLED' });
    expect(() => priceCart({ lines: [{ product: c, quantity: 1, prescriptionVerified: true }] }, { ...policy, blockControlled: true })).toThrow(/controlled/);
  });
});

describe('settleTenders', () => {
  it('computes change from cash only', () => {
    expect(settleTenders(1000, [{ method: 'CASH', amountMinor: 1500 }], false)).toEqual({ paidMinor: 1000, changeMinor: 500, cashKeptMinor: 1000, creditMinor: 0 });
  });
  it('supports split tender', () => {
    const r = settleTenders(1000, [{ method: 'CARD', amountMinor: 600 }, { method: 'CASH', amountMinor: 500 }], false);
    expect(r.changeMinor).toBe(100);
    expect(r.cashKeptMinor).toBe(400);
  });
  it('rejects underpayment, non-cash overpayment, and credit without customer', () => {
    expect(() => settleTenders(1000, [{ method: 'CASH', amountMinor: 900 }], false)).toThrow(/less than total/);
    expect(() => settleTenders(1000, [{ method: 'CARD', amountMinor: 1100 }], false)).toThrow(/Non-cash/);
    expect(() => settleTenders(1000, [{ method: 'CREDIT', amountMinor: 1000 }], false)).toThrow(/require a customer/);
    expect(settleTenders(1000, [{ method: 'CREDIT', amountMinor: 1000 }], true).creditMinor).toBe(1000);
  });
});
