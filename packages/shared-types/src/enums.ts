export const BatchStatuses = ['ACTIVE', 'QUARANTINED', 'RECALLED', 'EXPIRED', 'DEPLETED', 'RETURNED'] as const;
export type BatchStatus = (typeof BatchStatuses)[number];

export const MovementTypes = [
  'RECEIPT',
  'SALE',
  'SALE_RETURN',
  'PURCHASE_RETURN',
  'ADJUSTMENT',
  'COUNT_ADJUSTMENT',
  'QUARANTINE',
  'RELEASE',
  'WRITE_OFF',
  'REVERSAL',
] as const;
export type MovementType = (typeof MovementTypes)[number];

export const PurchaseOrderStatuses = [
  'DRAFT',
  'SUBMITTED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;
export type PurchaseOrderStatus = (typeof PurchaseOrderStatuses)[number];

export const GoodsReceiptStatuses = ['ACCEPTED', 'REVERSED'] as const;
export type GoodsReceiptStatus = (typeof GoodsReceiptStatuses)[number];

export const PurchaseReturnStatuses = ['DRAFT', 'FINALIZED', 'CANCELLED'] as const;
export type PurchaseReturnStatus = (typeof PurchaseReturnStatuses)[number];

export const SaleStatuses = ['COMPLETED', 'PARTIALLY_RETURNED', 'RETURNED', 'VOIDED'] as const;
export type SaleStatus = (typeof SaleStatuses)[number];

export const PaymentMethods = ['CASH', 'CARD', 'BANK_TRANSFER', 'MOBILE_WALLET', 'CREDIT'] as const;
export type PaymentMethod = (typeof PaymentMethods)[number];

export const PaymentStatuses = ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'] as const;
export type PaymentStatus = (typeof PaymentStatuses)[number];

export const SaleReturnStatuses = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'] as const;
export type SaleReturnStatus = (typeof SaleReturnStatuses)[number];

export const ReturnDispositions = ['RESTOCK', 'QUARANTINE', 'WRITE_OFF'] as const;
export type ReturnDisposition = (typeof ReturnDispositions)[number];

export const CashSessionStatuses = ['OPEN', 'CLOSED', 'RECONCILED'] as const;
export type CashSessionStatus = (typeof CashSessionStatuses)[number];

export const CashMovementTypes = ['CASH_IN', 'CASH_OUT', 'SALE', 'REFUND'] as const;
export type CashMovementType = (typeof CashMovementTypes)[number];

export const StockCountStatuses = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type StockCountStatus = (typeof StockCountStatuses)[number];

export const AlertTypes = [
  'EXPIRY_RISK',
  'STOCKOUT_RISK',
  'LOW_STOCK',
  'COUNT_DISCREPANCY',
  'PENDING_DELIVERY',
  'UNCLOSED_SESSION',
  'RECONCILIATION_ISSUE',
  'UNUSUAL_ADJUSTMENT',
] as const;
export type AlertType = (typeof AlertTypes)[number];

export const AlertSeverities = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type AlertSeverity = (typeof AlertSeverities)[number];

export const AlertStatuses = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'] as const;
export type AlertStatus = (typeof AlertStatuses)[number];

export const SaleRestrictions = ['OTC', 'PRESCRIPTION', 'CONTROLLED'] as const;
export type SaleRestriction = (typeof SaleRestrictions)[number];

export const ExpiryPrecisions = ['DAY', 'MONTH'] as const;
export type ExpiryPrecision = (typeof ExpiryPrecisions)[number];

export const ExpenseCategories = [
  'RENT',
  'UTILITIES',
  'SALARIES',
  'SUPPLIES',
  'MAINTENANCE',
  'MARKETING',
  'TRANSPORT',
  'OTHER',
] as const;
export type ExpenseCategory = (typeof ExpenseCategories)[number];

export const LedgerEntryTypes = ['CREDIT_SALE', 'PAYMENT', 'ADJUSTMENT', 'REFUND'] as const;
export type LedgerEntryType = (typeof LedgerEntryTypes)[number];
