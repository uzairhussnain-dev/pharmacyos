import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats integer minor units (paisa) into Pakistani Rupees (PKR).
 * Example: 250 -> "Rs. 2.50", 100000 -> "Rs. 1,000.00"
 */
export function formatPKR(paisa: number | null | undefined): string {
  if (paisa === null || paisa === undefined || isNaN(paisa)) return 'Rs. 0.00';
  const major = paisa / 100;
  return `Rs. ${major.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}


/**
 * Compact format for badges or large stats
 * Example: 1500000 -> "Rs. 15k"
 */
export function formatPKRCompact(paisa: number): string {
  const major = (paisa || 0) / 100;
  if (major >= 1_000_000) return `Rs. ${(major / 1_000_000).toFixed(1)}M`;
  if (major >= 1_000) return `Rs. ${(major / 1_000).toFixed(1)}k`;
  return `Rs. ${major.toFixed(0)}`;
}

/**
 * Formats ISO date into readable Pakistan-standard business format.
 * Example: 2026-10-18T10:00:00.000Z -> "18 Oct 2026, 3:00 PM"
 */
export function formatDate(isoDate: string | Date | null | undefined): string {
  if (!isoDate) return '—';
  const date = typeof isoDate === 'string' ? new Date(isoDate) : isoDate;
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(isoDate: string | Date | null | undefined): string {
  if (!isoDate) return '—';
  const date = typeof isoDate === 'string' ? new Date(isoDate) : isoDate;
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}
