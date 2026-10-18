import { allocateProportionally, applyBps, multiply, roundHalfUp, sum, toMinor } from './money';

describe('money', () => {
  it('converts major to minor with half-up rounding', () => {
    expect(toMinor(12.345)).toBe(1235);
    expect(toMinor(12.344)).toBe(1234);
    expect(toMinor(0.005)).toBe(1);
    expect(toMinor(1.1)).toBe(110);
  });

  it('rounds half-up, symmetric for negatives', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(2.4999999999)).toBe(3);
    expect(roundHalfUp(2.49)).toBe(2);
  });

  it('applies basis points', () => {
    expect(applyBps(10000, 1700)).toBe(1700);
    expect(applyBps(999, 1700)).toBe(170);
    expect(applyBps(1, 50)).toBe(0);
    expect(() => applyBps(10.5, 100)).toThrow();
  });

  it('multiplies price by quantity', () => {
    expect(multiply(1250, 3)).toBe(3750);
    expect(multiply(333, 0.5)).toBe(167);
  });

  it('allocates proportionally preserving total', () => {
    const parts = allocateProportionally(1000, [1, 1, 1]);
    expect(sum(parts)).toBe(1000);
    expect(parts).toEqual([334, 333, 333]);
    expect(allocateProportionally(100, [0, 0])).toEqual([0, 0]);
    expect(allocateProportionally(7, [3, 7])).toEqual([2, 5]);
  });

  it('rejects non-integer minor amounts', () => {
    expect(() => sum([1, 2.5])).toThrow(TypeError);
  });
});
