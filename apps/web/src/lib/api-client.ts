import type {
  AlertDto,
  BatchDto,
  CashSessionDto,
  Paginated,
  ProductDto,
  PurchaseOrderDto,
  SaleDto,
  StockMovementDto,
  UserDto,
} from '@pharmacy-os/shared-types';

export interface CustomerDto {
  id: string;
  name: string;
  phone: string;
  address?: string;
  creditEnabled: boolean;
  creditLimitMinor: number;
  balanceMinor?: number;
  consentToContact?: boolean;
  createdAt: string;
}


const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
  if (typeof window !== 'undefined') {
    if (token) {
      localStorage.setItem('pos_token', token);
    } else {
      localStorage.removeItem('pos_token');
    }
  }
}

export function getAccessToken(): string | null {
  if (accessToken) return accessToken;
  if (typeof window !== 'undefined') {
    accessToken = localStorage.getItem('pos_token');
  }
  return accessToken;
}

export class ApiError extends Error {
  statusCode: number;
  code?: string;
  details?: unknown;

  constructor(statusCode: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  isRetry = false
): Promise<T> {
  const url = `${API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const token = getAccessToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-requested-with': 'PharmacyOS',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // Include pos_refresh cookie
  });

  if (res.status === 401 && !isRetry && !endpoint.includes('/auth/')) {
    // Attempt token refresh
    try {
      const refreshed = await api.auth.refresh();
      setAccessToken(refreshed.accessToken);
      return request<T>(endpoint, options, true);
    } catch {
      setAccessToken(null);
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
      throw new ApiError(401, 'Session expired. Please log in again.');
    }
  }

  if (!res.ok) {
    let errBody: { message?: string | string[]; code?: string; details?: unknown } = {};
    try {
      errBody = await res.json();
    } catch {
      // not JSON
    }
    const message = Array.isArray(errBody.message)
      ? errBody.message.join(', ')
      : errBody.message || res.statusText || 'An error occurred';
    throw new ApiError(res.status, message, errBody.code, errBody.details);
  }

  if (res.status === 204) {
    return {} as T;
  }

  return res.json();
}

export const api = {
  auth: {
    login: (body: { username: string; password: string }) =>
      request<{ accessToken: string; expiresIn: number; user: UserDto }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    refresh: () =>
      request<{ accessToken: string; expiresIn: number; user: UserDto }>('/auth/refresh', {
        method: 'POST',
      }),
    logout: () =>
      request<void>('/auth/logout', {
        method: 'POST',
      }),
    me: () => request<UserDto>('/auth/me'),
  },

  reports: {
    dashboard: () =>
      request<{
        today: { salesMinor: number; transactions: number; grossProfitMinor: number; marginBps: number };
        yesterday: { salesMinor: number; transactions: number; grossProfitMinor: number; marginBps: number };
        inventoryCostValueMinor: number;
        openCashSessions: number;
      }>('/reports/dashboard'),
    sales: (params?: { from?: string; to?: string; groupBy?: string }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<{
        range: { from: string; to: string };
        groupBy: string;
        series: {
          period: string;
          grossMinor: number;
          discountMinor: number;
          taxMinor: number;
          totalMinor: number;
          costMinor: number;
          count: number;
        }[];
        totals: {
          grossMinor: number;
          discountMinor: number;
          taxMinor: number;
          totalMinor: number;
          costMinor: number;
          count: number;
          returnsMinor: number;
          returnCount: number;
          netSalesMinor: number;
          avgBasketMinor: number;
        };
        paymentMethods: { method: string; amountMinor: number; count: number }[];
      }>(`/reports/sales${qs ? `?${qs}` : ''}`);
    },
    grossProfit: (params?: { from?: string; to?: string }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<{ salesMinor: number; costMinor: number; grossProfitMinor: number; marginBps: number; transactions: number }>(
        `/reports/gross-profit${qs ? `?${qs}` : ''}`
      );
    },
    inventoryValue: () =>
      request<{ totalCostValueMinor: number; totalSellingValueMinor: number; batchCount: number }>(
        '/reports/inventory-value'
      ),
    expiryLoss: (params?: { from?: string; to?: string }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<{ totalLossMinor: number; units: number; items: unknown[] }>(
        `/reports/expiry-loss${qs ? `?${qs}` : ''}`
      );
    },
    topProducts: (params?: { from?: string; to?: string; limit?: number }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<{ productId: string; name: string; sku: string; unitsSold: number; revenueMinor: number; profitMinor: number }[]>(
        `/reports/top-products${qs ? `?${qs}` : ''}`
      );
    },
    slowMovers: (params?: { from?: string; to?: string }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<{ productId: string; name: string; sku: string; onHandUnits: number; daysWithoutSale: number; stockValueMinor: number }[]>(
        `/reports/slow-movers${qs ? `?${qs}` : ''}`
      );
    },
  },

  products: {
    list: (params?: { search?: string; category?: string; page?: number; pageSize?: number }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<Paginated<ProductDto>>(`/products${qs ? `?${qs}` : ''}`);
    },
    categories: () => request<string[]>('/products/categories'),
    lookup: (barcode: string) =>
      request<{ product: ProductDto; matchedPackUnit?: string }>(
        `/products/lookup?barcode=${encodeURIComponent(barcode)}`
      ),
    search: (q: string) => request<ProductDto[]>(`/products/search?q=${encodeURIComponent(q)}`),
    getById: (id: string) => request<ProductDto>(`/products/${id}`),
    create: (body: Partial<ProductDto>) =>
      request<ProductDto>('/products', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: Partial<ProductDto>) =>
      request<ProductDto>(`/products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
  },

  inventory: {
    summary: () =>
      request<{
        totalBatches: number;
        totalUnits: number;
        costValueMinor: number;
        expiringWithin30Days: number;
        expiredUnits: number;
        lowStockProducts: number;
      }>('/inventory/summary'),
    batches: (params?: { productId?: string; status?: string; expiringWithinDays?: number; page?: number; pageSize?: number }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<Paginated<BatchDto>>(`/inventory/batches${qs ? `?${qs}` : ''}`);
    },
    getBatch: (id: string) => request<BatchDto>(`/inventory/batches/${id}`),
    setBatchStatus: (id: string, body: { status: string; reason?: string }) =>
      request<BatchDto>(`/inventory/batches/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    movements: (params?: { productId?: string; batchId?: string; type?: string; page?: number; pageSize?: number }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<Paginated<StockMovementDto>>(`/inventory/movements${qs ? `?${qs}` : ''}`);
    },
    adjust: (body: { batchId: string; quantityUnits: number; type: 'WRITE_OFF' | 'ADJUSTMENT' | 'COUNT_ADJUSTMENT'; reason: string }) =>
      request<StockMovementDto>('/inventory/adjustments', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    counts: (params?: { status?: string; page?: number; pageSize?: number }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<Paginated<any>>(`/inventory/counts${qs ? `?${qs}` : ''}`);
    },
    getCount: (id: string) => request<any>(`/inventory/counts/${id}`),
    createCount: (body: { name: string; productIds: string[] }) =>
      request<any>('/inventory/counts', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    submitCount: (id: string) =>
      request<any>(`/inventory/counts/${id}/submit`, {
        method: 'POST',
      }),
    approveCount: (id: string) =>
      request<any>(`/inventory/counts/${id}/approve`, {
        method: 'POST',
      }),
    rejectCount: (id: string, body: { reason: string }) =>
      request<any>(`/inventory/counts/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    expiryRisk: (withinDays = 180) =>
      request<{ productId: string; name: string; sku: string; batchNumber: string; expiryDate: string; onHandUnits: number; estimatedLossMinor: number }[]>(
        `/inventory/expiry-risk?withinDays=${withinDays}`
      ),
    stockoutRisk: () =>
      request<{ productId: string; name: string; sku: string; onHandUnits: number; reorderLevel: number; dailyVelocity: number; daysRemaining: number }[]>(
        '/inventory/stockout-risk'
      ),
  },

  pos: {
    quote: (body: { lines: { productId: string; unitName?: string; quantity: number; discountMinor?: number; prescriptionVerified?: boolean }[]; orderDiscountMinor?: number; customerId?: string }) =>
      request<{
        lines: {
          productId: string;
          sku: string;
          name: string;
          unitName: string;
          unitMultiplier: number;
          quantity: number;
          quantityUnits: number;
          unitPriceMinor: number;
          discountMinor: number;
          taxMinor: number;
          lineTotalMinor: number;
          allocations: { batchId: string; batchNumber: string; expiryDate: string; quantityUnits: number }[];
        }[];
        subtotalMinor: number;
        discountMinor: number;
        taxMinor: number;
        totalMinor: number;
      }>('/pos/sales/quote', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    checkout: (body: {
      idempotencyKey: string;
      lines: { productId: string; unitName?: string; quantity: number; discountMinor?: number; prescriptionVerified?: boolean }[];
      tenders: { method: string; amountMinor: number; reference?: string }[];
      orderDiscountMinor?: number;
      customerId?: string;
      notes?: string;
    }) =>
      request<SaleDto>('/pos/sales', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    listHeld: () => request<{ id: string; label?: string; lines: any[]; customerId?: string; createdAt: string }[]>('/pos/held'),
    hold: (body: { label?: string; lines: any[]; orderDiscountMinor?: number; customerId?: string }) =>
      request<any>('/pos/held', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    releaseHeld: (id: string) =>
      request<void>(`/pos/held/${id}`, {
        method: 'DELETE',
      }),
  },

  sales: {
    list: (params?: { search?: string; cashierId?: string; customerId?: string; from?: string; to?: string; page?: number; pageSize?: number }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<Paginated<SaleDto>>(`/sales${qs ? `?${qs}` : ''}`);
    },
    getById: (id: string) => request<SaleDto>(`/sales/${id}`),
    receipt: (id: string) =>
      request<{
        pharmacy: { name: string; address: string; phone: string; license: string; receiptFooter?: string };
        sale: SaleDto;
      }>(`/sales/${id}/receipt`),
    listReturns: (params?: { status?: string; page?: number; pageSize?: number }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<Paginated<any>>(`/sales/returns${qs ? `?${qs}` : ''}`);
    },
    createReturn: (saleId: string, body: { lines: { lineIndex: number; quantityUnits: number; disposition: string }[]; reason: string; refundMethod?: string }) =>
      request<any>(`/sales/${saleId}/returns`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    approveReturn: (saleId: string, returnId: string) =>
      request<any>(`/sales/${saleId}/returns/${returnId}/approve`, {
        method: 'POST',
      }),
    rejectReturn: (saleId: string, returnId: string, body: { reason: string }) =>
      request<any>(`/sales/${saleId}/returns/${returnId}/reject`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  purchasing: {
    listOrders: (params?: { supplierId?: string; status?: string; page?: number; pageSize?: number }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<Paginated<PurchaseOrderDto>>(`/purchase-orders${qs ? `?${qs}` : ''}`);
    },
    createOrder: (body: { supplierId: string; lines: { productId: string; quantityUnits: number; unitCostMinor: number }[]; expectedDeliveryDate?: string }) =>
      request<PurchaseOrderDto>('/purchase-orders', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    getOrder: (id: string) => request<PurchaseOrderDto>(`/purchase-orders/${id}`),
    updateOrder: (id: string, body: Partial<PurchaseOrderDto>) =>
      request<PurchaseOrderDto>(`/purchase-orders/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    submitOrder: (id: string) =>
      request<PurchaseOrderDto>(`/purchase-orders/${id}/submit`, {
        method: 'POST',
      }),
    receiveOrder: (id: string, body: { lines: { productId: string; batchNumber: string; expiryDate: string; quantityUnits: number; unitCostMinor: number }[]; supplierInvoiceNumber?: string }) =>
      request<any>(`/purchase-orders/${id}/receive`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    listReceipts: (params?: { supplierId?: string; page?: number; pageSize?: number }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<Paginated<any>>(`/goods-receipts${qs ? `?${qs}` : ''}`);
    },
    receiveDirect: (body: { supplierId: string; lines: { productId: string; batchNumber: string; expiryDate: string; quantityUnits: number; unitCostMinor: number }[]; supplierInvoiceNumber?: string }) =>
      request<any>('/goods-receipts', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    getReceipt: (id: string) => request<any>(`/goods-receipts/${id}`),
    paySupplier: (body: { supplierId: string; amountMinor: number; paymentMethod: string; reference?: string; notes?: string }) =>
      request<any>('/supplier-payments', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    listReturns: (params?: { supplierId?: string; page?: number; pageSize?: number }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<Paginated<any>>(`/purchase-returns${qs ? `?${qs}` : ''}`);
    },
    createReturn: (body: { supplierId: string; lines: { batchId: string; quantityUnits: number; unitCostMinor: number }[]; reason: string }) =>
      request<any>('/purchase-returns', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    finalizeReturn: (id: string) =>
      request<any>(`/purchase-returns/${id}/finalize`, {
        method: 'POST',
      }),
  },

  suppliers: {
    list: (params?: { search?: string; page?: number; pageSize?: number }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<Paginated<any>>(`/suppliers${qs ? `?${qs}` : ''}`);
    },
    getById: (id: string) => request<any>(`/suppliers/${id}`),
    create: (body: {
      name: string;
      contactName?: string;
      phone?: string;
      email?: string;
      address?: string;
      paymentTermsDays?: number;
      leadTimeDays?: number;
      ntn?: string;
      strn?: string;
      acceptsExpiryReturns?: boolean;
    }) =>
      request<any>('/suppliers', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: any) =>
      request<any>(`/suppliers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
  },

  cashSessions: {
    list: (params?: { cashierId?: string; status?: string; page?: number; pageSize?: number }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<Paginated<CashSessionDto>>(`/cash-sessions${qs ? `?${qs}` : ''}`);
    },
    current: () => request<CashSessionDto | null>('/cash-sessions/current'),
    getById: (id: string) => request<CashSessionDto>(`/cash-sessions/${id}`),
    open: (body: { openingFloatMinor: number }) =>
      request<CashSessionDto>('/cash-sessions/open', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    addMovement: (id: string, body: { type: 'CASH_IN' | 'CASH_OUT'; amountMinor: number; reason: string }) =>
      request<any>(`/cash-sessions/${id}/cash-movements`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    close: (id: string, body: { countedClosingMinor: number; notes?: string }) =>
      request<CashSessionDto>(`/cash-sessions/${id}/close`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    reconcile: (id: string, body: { notes?: string }) =>
      request<CashSessionDto>(`/cash-sessions/${id}/reconcile`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  customers: {
    list: (params?: { search?: string; page?: number; pageSize?: number }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<Paginated<CustomerDto>>(`/customers${qs ? `?${qs}` : ''}`);
    },
    getById: (id: string) => request<CustomerDto & { ledger: any[] }>(`/customers/${id}`),
    create: (body: { name: string; phone: string; address?: string; creditEnabled?: boolean; creditLimitMinor?: number }) =>
      request<CustomerDto>('/customers', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: Partial<CustomerDto>) =>
      request<CustomerDto>(`/customers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    recordPayment: (id: string, body: { amountMinor: number; paymentMethod: string; reference?: string; notes?: string }) =>
      request<any>(`/customers/${id}/payments`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  finance: {
    receivables: () => request<{ totalReceivableMinor: number; customers: { id: string; name: string; phone: string; balanceMinor: number; creditLimitMinor: number }[] }>('/finance/receivables'),
    payables: () => request<{ totalPayableMinor: number; suppliers: { id: string; name: string; phone: string; balanceMinor: number }[] }>('/finance/payables'),
  },

  expenses: {
    list: (params?: { category?: string; page?: number; pageSize?: number }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<Paginated<any>>(`/expenses${qs ? `?${qs}` : ''}`);
    },
    create: (body: { category: string; amountMinor: number; date: string; paymentMethod: string; description: string }) =>
      request<any>('/expenses', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    approve: (id: string) =>
      request<any>(`/expenses/${id}/approve`, {
        method: 'POST',
      }),
  },

  intelligence: {
    listActions: (params?: { status?: string; severity?: string; page?: number; pageSize?: number }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<Paginated<AlertDto>>(`/intelligence/actions${qs ? `?${qs}` : ''}`);
    },
    getAction: (id: string) => request<AlertDto>(`/intelligence/actions/${id}`),
    resolveAction: (id: string, body: { actionCode: string; note?: string }) =>
      request<AlertDto>(`/intelligence/actions/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    rebuild: () =>
      request<{ scanned: number; opened: number; closed: number }>('/intelligence/forecast/rebuild', {
        method: 'POST',
      }),
    forecasts: (productId?: string) => {
      const qs = productId ? `?productId=${encodeURIComponent(productId)}` : '';
      return request<any[]>(`/intelligence/forecasts${qs}`);
    },
    assistantTools: () => request<any[]>('/intelligence/assistant/tools'),
    ask: (question: string) =>
      request<{ question: string; answer: string; toolCalled?: string; evidence?: unknown }>('/intelligence/assistant/query', {
        method: 'POST',
        body: JSON.stringify({ question }),
      }),
  },

  audit: {
    list: (params?: { action?: string; entityType?: string; actorId?: string; page?: number; pageSize?: number }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<Paginated<any>>(`/audit-logs${qs ? `?${qs}` : ''}`);
    },
  },

  settings: {
    get: () =>
      request<{
        pharmacyName: string;
        addressLine: string;
        phone: string;
        licenseNumber: string;
        receiptFooter: string;
        taxId?: string;
      }>('/settings'),
    update: (body: any) =>
      request<any>('/settings', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
  },
};
