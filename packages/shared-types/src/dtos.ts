import type {
  AlertSeverity,
  AlertStatus,
  AlertType,
  BatchStatus,
  CashSessionStatus,
  ExpiryPrecision,
  MovementType,
  PaymentMethod,
  PaymentStatus,
  PurchaseOrderStatus,
  SaleRestriction,
  SaleReturnStatus,
  SaleStatus,
} from './enums';
import type { Permission, Role } from './permissions';

/** All monetary amounts are integer minor units (paisa for PKR). */
export type Minor = number;

export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
  timestamp: string;
  path: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserDto {
  id: string;
  name: string;
  username: string;
  role: Role;
  permissions: Permission[];
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
}

export interface PackUnit {
  name: string; // e.g. "Strip", "Box"
  multiplier: number; // how many base units
  barcode?: string;
  sellingPriceMinor?: Minor;
}

export interface ProductDto {
  id: string;
  sku: string;
  barcode?: string;
  brandName: string;
  genericName: string;
  strength?: string;
  dosageForm: string;
  route?: string;
  manufacturer?: string;
  registrationNumber?: string;
  category: string;
  baseUnit: string;
  packUnits: PackUnit[];
  sellingPriceMinor: Minor;
  taxClass: string;
  taxRateBps: number;
  saleRestriction: SaleRestriction;
  requiresPrescription: boolean;
  isActive: boolean;
  tracksExpiry: boolean;
  reorderLevel: number;
  reorderQuantity: number;
  leadTimeDays: number;
  onHandUnits?: number;
  eligibleUnits?: number;
  createdAt: string;
  updatedAt: string;
}

export interface BatchDto {
  id: string;
  productId: string;
  product?: Pick<ProductDto, 'id' | 'sku' | 'brandName' | 'genericName' | 'strength' | 'baseUnit'>;
  batchNumber: string;
  supplierLot?: string;
  expiryDate: string;
  expiryPrecision: ExpiryPrecision;
  purchaseCostMinor: Minor;
  landedUnitCostMinor: Minor;
  onHandUnits: number;
  reservedUnits: number;
  status: BatchStatus;
  receiptId?: string;
  supplierId?: string;
  receivedAt: string;
  createdAt: string;
}

export interface StockMovementDto {
  id: string;
  productId: string;
  batchId: string;
  type: MovementType;
  quantityUnits: number;
  sourceType: string;
  sourceId?: string;
  reason?: string;
  actorId: string;
  actorName?: string;
  requestId?: string;
  createdAt: string;
}

export interface SaleLineDto {
  productId: string;
  sku: string;
  name: string;
  unitName: string;
  unitMultiplier: number;
  quantity: number;
  quantityUnits: number;
  unitPriceMinor: Minor;
  discountMinor: Minor;
  taxMinor: Minor;
  lineTotalMinor: Minor;
  costBasisMinor: Minor;
  allocations: { batchId: string; batchNumber: string; expiryDate: string; quantityUnits: number; unitCostMinor: Minor }[];
  returnedUnits: number;
}

export interface SaleDto {
  id: string;
  invoiceNumber: string;
  cashierId: string;
  cashierName?: string;
  customerId?: string;
  customerName?: string;
  cashSessionId?: string;
  lines: SaleLineDto[];
  subtotalMinor: Minor;
  discountMinor: Minor;
  taxMinor: Minor;
  totalMinor: Minor;
  costMinor: Minor;
  paidMinor: Minor;
  changeMinor: Minor;
  paymentStatus: PaymentStatus;
  status: SaleStatus;
  payments: { id: string; method: PaymentMethod; amountMinor: Minor; status: PaymentStatus; reference?: string }[];
  createdAt: string;
}

export interface CashSessionDto {
  id: string;
  cashierId: string;
  cashierName?: string;
  openingFloatMinor: Minor;
  cashSalesMinor: Minor;
  cashRefundsMinor: Minor;
  cashInMinor: Minor;
  cashOutMinor: Minor;
  expectedClosingMinor: Minor;
  countedClosingMinor?: Minor;
  varianceMinor?: Minor;
  status: CashSessionStatus;
  openedAt: string;
  closedAt?: string;
  reconciledAt?: string;
  notes?: string;
}

export interface AlertDto {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  explanation: string;
  evidence: Record<string, unknown>;
  estimatedImpactMinor?: Minor;
  recommendedActions: { code: string; label: string; description: string; href?: string }[];
  entityType?: string;
  entityId?: string;
  resolution?: { actorId: string; actionCode: string; note?: string; resolvedAt: string; outcome?: Record<string, unknown> };
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderDto {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName?: string;
  status: PurchaseOrderStatus;
  lines: { productId: string; productName?: string; quantityUnits: number; receivedUnits: number; unitCostMinor: Minor }[];
  expectedDeliveryDate?: string;
  totalMinor: Minor;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaleReturnDto {
  id: string;
  saleId: string;
  invoiceNumber?: string;
  lines: { lineIndex: number; productId: string; name?: string; quantityUnits: number; disposition: string; refundMinor: Minor }[];
  refundMinor: Minor;
  reason: string;
  status: SaleReturnStatus;
  requestedById: string;
  approvedById?: string;
  createdAt: string;
}
