import { describe, it, expect } from 'vitest';
import { formatPKR, formatPKRCompact, formatDate, formatDateTime } from './utils';

describe('Currency and Date Formatters', () => {
  it('formats minor paisa units into PKR with symbol and decimals', () => {
    expect(formatPKR(0)).toBe('Rs. 0.00');
    expect(formatPKR(250)).toBe('Rs. 2.50');
    expect(formatPKR(100000)).toBe('Rs. 1,000.00');
    expect(formatPKR(null)).toBe('Rs. 0.00');
    expect(formatPKR(undefined)).toBe('Rs. 0.00');
  });

  it('formats compact PKR for large metrics', () => {
    expect(formatPKRCompact(50000)).toBe('Rs. 500');
    expect(formatPKRCompact(1500000)).toBe('Rs. 15.0k');
    expect(formatPKRCompact(250000000)).toBe('Rs. 2.5M');
  });

  it('formats dates into standard British / Pakistani format', () => {
    const d = '2026-10-18T10:00:00.000Z';
    expect(formatDate(d)).toContain('2026');
    expect(formatDate(null)).toBe('—');
  });
});
