/**
 * Money helpers. All amounts are integers in minor units (paisa for PKR: 1 PKR = 100 paisa).
 * Rounding policy: half-up on minor units ("commercial rounding"), applied once per line
 * and once per document-level amount. Never accumulate floats.
 */
export type Minor = number;

export const MINOR_PER_MAJOR = 100;

export function assertMinor(value: unknown, label = 'amount'): asserts value is Minor {
  if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be an integer minor-unit amount, got ${String(value)}`);
  }
}

export function toMinor(major: number): Minor {
  return roundHalfUp(major * MINOR_PER_MAJOR);
}

export function toMajor(minor: Minor): number {
  return minor / MINOR_PER_MAJOR;
}

/** Round a possibly-fractional minor amount half-up (away from zero for .5). */
export function roundHalfUp(value: number): Minor {
  if (!Number.isFinite(value)) throw new TypeError('Cannot round non-finite value');
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  // Add a tiny epsilon to counter floating error in e.g. 2.4999999999
  return sign * Math.floor(abs + 0.5 + 1e-9);
}

/** value * bps / 10000, rounded. bps = basis points (1% = 100 bps). */
export function applyBps(value: Minor, bps: number): Minor {
  assertMinor(value, 'value');
  if (!Number.isInteger(bps) || bps < 0) throw new TypeError('bps must be a non-negative integer');
  return roundHalfUp((value * bps) / 10_000);
}

export function multiply(unitPrice: Minor, quantity: number): Minor {
  assertMinor(unitPrice, 'unitPrice');
  if (!Number.isFinite(quantity) || quantity < 0) throw new TypeError('quantity must be >= 0');
  return roundHalfUp(unitPrice * quantity);
}

export function sum(values: Minor[]): Minor {
  return values.reduce((acc, v) => {
    assertMinor(v);
    return acc + v;
  }, 0);
}

/** Allocate `total` across `weights` proportionally without losing or creating minor units. */
export function allocateProportionally(total: Minor, weights: number[]): Minor[] {
  assertMinor(total, 'total');
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / weightSum);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = total - floored.reduce((a, b) => a + b, 0);
  // distribute remainder by largest fractional part
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floored[i] += 1;
    remainder -= 1;
  }
  return floored;
}

export function formatPKR(minor: Minor): string {
  const major = toMajor(minor);
  return `Rs ${major.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
