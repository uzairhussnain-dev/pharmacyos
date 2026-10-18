import { Types } from 'mongoose';
import { isBatchEligible } from '../../database/schemas/batch.schema';
import { allocateFefo } from './stock-ledger.service';

const d = (iso: string) => new Date(iso);
const batch = (id: string, expiry: string, onHand: number, cost = 100, reserved = 0) => ({
  _id: new Types.ObjectId(id.padStart(24, '0')),
  batchNumber: `B${id}`,
  expiryDate: d(expiry),
  onHandUnits: onHand,
  reservedUnits: reserved,
  landedUnitCostMinor: cost,
});

describe('allocateFefo', () => {
  it('allocates from the earliest-expiring batch first', () => {
    const result = allocateFefo([batch('2', '2027-06-30', 10, 120), batch('1', '2026-12-31', 5, 100)], 7);
    expect(result).not.toBeNull();
    expect(result!.map((a) => [a.batchNumber, a.quantityUnits])).toEqual([
      ['B1', 5],
      ['B2', 2],
    ]);
    expect(result![0].unitCostMinor).toBe(100);
    expect(result![1].unitCostMinor).toBe(120);
  });

  it('returns null when total available is insufficient (no partial allocation)', () => {
    expect(allocateFefo([batch('1', '2026-12-31', 3), batch('2', '2027-01-01', 3)], 7)).toBeNull();
  });

  it('respects reserved units', () => {
    const result = allocateFefo([batch('1', '2026-12-31', 10, 100, 8)], 2);
    expect(result![0].quantityUnits).toBe(2);
    expect(allocateFefo([batch('1', '2026-12-31', 10, 100, 9)], 2)).toBeNull();
  });

  it('skips empty batches and is deterministic on equal expiry', () => {
    const result = allocateFefo([batch('3', '2026-12-31', 0), batch('2', '2026-12-31', 4), batch('1', '2026-12-31', 4)], 6);
    expect(result!.map((a) => a.batchNumber)).toEqual(['B1', 'B2']);
  });

  it('rejects non-positive quantities', () => {
    expect(() => allocateFefo([], 0)).toThrow(TypeError);
    expect(() => allocateFefo([], 1.5)).toThrow(TypeError);
  });
});

describe('isBatchEligible', () => {
  // Expiry dates are normalised to end-of-day local time on receipt (see purchasing normalizeExpiry):
  // a batch is sellable through its expiry date and blocked from the following day.
  const eod = (y: number, m: number, day: number) => new Date(y, m - 1, day, 23, 59, 59, 999);
  const now = new Date(2026, 9, 18, 10, 0, 0); // 18 Oct 2026 10:00 local
  it('rejects expired, quarantined, recalled and depleted batches', () => {
    expect(isBatchEligible({ status: 'ACTIVE', expiryDate: eod(2026, 10, 17), onHandUnits: 5, reservedUnits: 0 }, now)).toBe(false);
    expect(isBatchEligible({ status: 'ACTIVE', expiryDate: eod(2026, 9, 30), onHandUnits: 5, reservedUnits: 0 }, now)).toBe(false);
    expect(isBatchEligible({ status: 'QUARANTINED', expiryDate: eod(2027, 1, 1), onHandUnits: 5, reservedUnits: 0 }, now)).toBe(false);
    expect(isBatchEligible({ status: 'RECALLED', expiryDate: eod(2027, 1, 1), onHandUnits: 5, reservedUnits: 0 }, now)).toBe(false);
    expect(isBatchEligible({ status: 'ACTIVE', expiryDate: eod(2027, 1, 1), onHandUnits: 0, reservedUnits: 0 }, now)).toBe(false);
    expect(isBatchEligible({ status: 'ACTIVE', expiryDate: eod(2027, 1, 1), onHandUnits: 3, reservedUnits: 3 }, now)).toBe(false);
  });
  it('accepts active, in-date batches with free units (including on the expiry day itself)', () => {
    expect(isBatchEligible({ status: 'ACTIVE', expiryDate: eod(2026, 10, 18), onHandUnits: 1, reservedUnits: 0 }, now)).toBe(true);
    expect(isBatchEligible({ status: 'ACTIVE', expiryDate: eod(2026, 10, 19), onHandUnits: 1, reservedUnits: 0 }, now)).toBe(true);
  });
});
