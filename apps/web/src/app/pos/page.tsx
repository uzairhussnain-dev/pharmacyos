'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import {
  Search,
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  Receipt,
  CreditCard,
  Banknote,
  Smartphone,
  CheckCircle,
  AlertCircle,
  Pause,
  Play,
  ArrowLeft,
  Sparkles,
  Printer,
  X,
  Lock,
  CircleDollarSign,
  User,
  Percent,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { formatPKR, formatDate, formatDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import type { ProductDto, SaleDto } from '@pharmacy-os/shared-types';

interface CartItem {
  productId: string;
  sku: string;
  brandName: string;
  genericName: string;
  dosageForm: string;
  baseUnit: string;
  availableUnits: number;
  packUnits: { name: string; multiplier: number; sellingPriceMinor?: number }[];
  selectedUnitName?: string;
  selectedMultiplier: number;
  quantity: number; // in chosen unit
  unitPriceMinor: number;
  discountMinor: number;
  requiresPrescription: boolean;
  prescriptionVerified: boolean;
}

export default function PosPage() {
  const queryClient = useQueryClient();
  const { user, hasPermission } = useAuth();

  // Search input ref
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<{ id: string; name: string } | null>(null);

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderDiscountPercent, setOrderDiscountPercent] = useState<number>(0);

  // Active cashier session
  const { data: currentSession, refetch: refetchSession } = useQuery({
    queryKey: ['cash-session-current', user?.id],
    queryFn: () => api.cashSessions.current(),
    enabled: !!user,
  });

  // Open drawer modal state
  const [openSessionModal, setOpenSessionModal] = useState(false);
  const [openingFloat, setOpeningFloat] = useState<number>(5000); // PKR

  // Checkout modal & payment state
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'MOBILE_WALLET' | 'CREDIT'>('CASH');
  const [cashTendered, setCashTendered] = useState<string>('');
  const [paymentReference, setPaymentReference] = useState<string>('');
  const [checkoutNotes, setCheckoutNotes] = useState<string>('');

  // Held carts modal state
  const [heldModalOpen, setHeldModalOpen] = useState(false);
  const { data: heldCarts, refetch: refetchHeld } = useQuery({
    queryKey: ['pos-held-carts'],
    queryFn: () => api.pos.listHeld(),
  });

  // Receipt modal state
  const [receiptSale, setReceiptSale] = useState<SaleDto | null>(null);
  const [receiptPharmacy, setReceiptPharmacy] = useState<any>(null);

  // Product search results
  const { data: searchResults, isFetching: isSearching } = useQuery({
    queryKey: ['pos-product-search', searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim()) return [];
      return api.products.search(searchQuery.trim());
    },
    enabled: searchQuery.trim().length >= 2,
  });

  // Customer search query
  const { data: customers } = useQuery({
    queryKey: ['customers-list-pos'],
    queryFn: () => api.customers.list({ pageSize: 50 }),
  });

  // Server quote query to ensure authoritative totals
  const quoteLines = useMemo(() => {
    return cart.map((c) => ({
      productId: c.productId,
      unitName: c.selectedUnitName,
      quantity: c.quantity,
      discountMinor: c.discountMinor,
      prescriptionVerified: c.prescriptionVerified,
    }));
  }, [cart]);

  const { data: serverQuote } = useQuery({
    queryKey: ['pos-quote', quoteLines, orderDiscountPercent, selectedCustomer?.id],
    queryFn: async () => {
      if (quoteLines.length === 0) return null;
      return api.pos.quote({
        lines: quoteLines,
        customerId: selectedCustomer?.id,
      });
    },
    enabled: quoteLines.length > 0,
  });

  // Calculations
  const calculatedSubtotalMinor = serverQuote?.subtotalMinor ?? cart.reduce((sum, c) => sum + c.unitPriceMinor * c.quantity, 0);
  const calculatedDiscountMinor = serverQuote?.discountMinor ?? Math.round(calculatedSubtotalMinor * (orderDiscountPercent / 100));
  const calculatedTaxMinor = serverQuote?.taxMinor ?? 0;
  const calculatedTotalMinor = serverQuote?.totalMinor ?? (calculatedSubtotalMinor - calculatedDiscountMinor + calculatedTaxMinor);

  // Cash change calculation
  const tenderedMinor = Math.round((parseFloat(cashTendered) || 0) * 100);
  const changeMinor = Math.max(0, tenderedMinor - calculatedTotalMinor);

  // Open Cash Session Mutation
  const openSessionMutation = useMutation({
    mutationFn: async (floatPKR: number) => {
      return api.cashSessions.open({ openingFloatMinor: Math.round(floatPKR * 100) });
    },
    onSuccess: () => {
      toast.success('Cash drawer session opened successfully');
      setOpenSessionModal(false);
      refetchSession();
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to open cash drawer session');
    },
  });

  // Transactional Checkout Mutation with Idempotency Key
  const checkoutMutation = useMutation({
    mutationFn: async () => {
      if (!currentSession) {
        throw new Error('An active cash drawer session is required before checkout');
      }
      if (cart.length === 0) {
        throw new Error('Cart is empty');
      }

      const tenderAmountMinor = paymentMethod === 'CASH'
        ? Math.max(tenderedMinor, calculatedTotalMinor)
        : calculatedTotalMinor;

      const payload = {
        idempotencyKey: crypto.randomUUID(),
        lines: cart.map((c) => ({
          productId: c.productId,
          unitName: c.selectedUnitName,
          quantity: c.quantity,
          discountMinor: c.discountMinor,
          prescriptionVerified: c.prescriptionVerified,
        })),
        tenders: [
          {
            method: paymentMethod,
            amountMinor: tenderAmountMinor,
            reference: paymentReference || undefined,
          },
        ],
        customerId: selectedCustomer?.id,
        notes: checkoutNotes || undefined,
      };

      return api.pos.checkout(payload);
    },
    onSuccess: async (sale) => {
      toast.success(`Sale completed! Invoice: ${sale.invoiceNumber}`);
      setCart([]);
      setCashTendered('');
      setPaymentReference('');
      setCheckoutNotes('');
      setCheckoutModalOpen(false);

      // Fetch printable receipt details
      try {
        const receiptData = await api.sales.receipt(sale.id);
        setReceiptPharmacy(receiptData.pharmacy);
        setReceiptSale(receiptData.sale);
      } catch {
        setReceiptSale(sale);
      }

      // Invalidate relevant caches
      queryClient.invalidateQueries({ queryKey: ['reports-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['cash-session-current'] });
      queryClient.invalidateQueries({ queryKey: ['recent-sales'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-batches'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Checkout failed');
    },
  });

  // Hold Cart Mutation
  const holdCartMutation = useMutation({
    mutationFn: async (label: string) => {
      return api.pos.hold({
        label,
        lines: cart.map((c) => ({
          productId: c.productId,
          unitName: c.selectedUnitName,
          quantity: c.quantity,
          discountMinor: c.discountMinor,
          prescriptionVerified: c.prescriptionVerified,
        })),
        customerId: selectedCustomer?.id,
      });
    },
    onSuccess: () => {
      toast.success('Cart held');
      setCart([]);
      refetchHeld();
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to hold cart');
    },
  });

  // Release Held Cart
  const releaseHeldMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.pos.releaseHeld(id);
    },
    onSuccess: () => {
      refetchHeld();
    },
  });

  // Keyboard Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === 'F4') {
        e.preventDefault();
        setOpenSessionModal((prev) => !prev);
      } else if (e.key === 'F7') {
        e.preventDefault();
        setHeldModalOpen(true);
      } else if (e.key === 'F8') {
        e.preventDefault();
        if (cart.length > 0) {
          const label = `Cart ${new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}`;
          holdCartMutation.mutate(label);
        }
      } else if (e.key === 'F9') {
        e.preventDefault();
        if (cart.length > 0) {
          setCashTendered((calculatedTotalMinor / 100).toFixed(2));
          setCheckoutModalOpen(true);
        }
      } else if (e.key === 'Escape') {
        setCheckoutModalOpen(false);
        setHeldModalOpen(false);
        setOpenSessionModal(false);
        setReceiptSale(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, calculatedTotalMinor, holdCartMutation]);

  // Add Product to Cart
  const addToCart = (product: ProductDto, matchedPackUnit?: string) => {
    if ((product.eligibleUnits ?? 0) <= 0) {
      toast.error(`Out of stock: ${product.brandName} has 0 eligible units.`);
      return;
    }

    const pack = matchedPackUnit ? product.packUnits?.find((p) => p.name === matchedPackUnit) : undefined;
    const unitName = pack ? pack.name : undefined;
    const multiplier = pack ? pack.multiplier : 1;

    setCart((prev) => {
      const existing = prev.find((i) => i.productId === product.id && i.selectedUnitName === unitName);
      if (existing) {
        return prev.map((i) =>
          i.productId === product.id && i.selectedUnitName === unitName
            ? { ...i, quantity: i.quantity + 1 }
            : i
        );
      }

      return [
        ...prev,
        {
          productId: product.id,
          sku: product.sku,
          brandName: product.brandName,
          genericName: product.genericName,
          dosageForm: product.dosageForm,
          baseUnit: product.baseUnit,
          availableUnits: product.eligibleUnits ?? 0,
          packUnits: product.packUnits || [],
          selectedUnitName: unitName,
          selectedMultiplier: multiplier,
          quantity: 1,
          unitPriceMinor: product.sellingPriceMinor,
          discountMinor: 0,
          requiresPrescription: product.requiresPrescription || product.saleRestriction === 'PRESCRIPTION',
          prescriptionVerified: true,
        },
      ];
    });

    setSearchQuery('');
    searchInputRef.current?.focus();
  };

  const handleSearchKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const query = searchQuery.trim();
      if (!query) return;

      try {
        const lookupRes = await api.products.lookup(query);
        if (lookupRes && lookupRes.product) {
          addToCart(lookupRes.product, lookupRes.matchedPackUnit);
          return;
        }
      } catch {
        // Fallback: if searchResults has items, select the first in-stock one
        if (searchResults && searchResults.length > 0) {
          const firstInStock = searchResults.find((p) => (p.eligibleUnits ?? 0) > 0) || searchResults[0];
          addToCart(firstInStock);
        }
      }
    }
  };

  // Change Packaging Unit (e.g., base unit to Strip or Box)
  const changeUnit = (index: number, unitName: string | undefined) => {
    setCart((prev) => {
      const next = [...prev];
      const item = next[index];
      if (!unitName) {
        item.selectedUnitName = undefined;
        item.selectedMultiplier = 1;
      } else {
        const pack = item.packUnits.find((p) => p.name === unitName);
        if (pack) {
          item.selectedUnitName = pack.name;
          item.selectedMultiplier = pack.multiplier;
        }
      }
      return next;
    });
  };

  // Update item quantity
  const updateQuantity = (index: number, newQty: number) => {
    if (newQty <= 0) {
      removeFromCart(index);
      return;
    }
    setCart((prev) => {
      const next = [...prev];
      next[index].quantity = newQty;
      return next;
    });
  };

  // Remove item
  const removeFromCart = (index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  };

  // Trigger browser print for thermal receipt
  const printReceipt = () => {
    window.print();
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F4F7F6]">
      {/* Main Left: POS Workspace (Search & Product Selection) */}
      <div className="flex flex-1 flex-col overflow-hidden border-r border-[#d1deda]">
        {/* POS Top Navigation Header */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#d1deda] bg-white px-5">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#d1deda] text-slate-600 hover:bg-[#f3f7f6] transition-colors"
              title="Return to Dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-[#122A36] text-base">Point of Sale Counter</span>
                <Badge variant="default" className="text-[10px] uppercase font-bold py-0">
                  Live FEFO
                </Badge>
              </div>
              <p className="text-[11px] text-slate-500">
                Cashier: <span className="font-semibold text-slate-700">{user?.name}</span> ({user?.role})
              </p>
            </div>
          </div>

          {/* Center / Right Drawer and Held controls */}
          <div className="flex items-center gap-2">
            {/* Drawer Status */}
            <button
              onClick={() => setOpenSessionModal(true)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                currentSession
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  : 'border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100'
              }`}
            >
              <CircleDollarSign className="h-4 w-4" />
              <span>{currentSession ? 'Drawer Open (F4)' : 'Open Drawer (F4)'}</span>
              <span
                className={`h-2 w-2 rounded-full ${
                  currentSession ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
                }`}
              />
            </button>

            {/* Held Carts */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHeldModalOpen(true)}
              className="gap-1.5 border-[#d1deda] text-xs"
            >
              <Pause className="h-3.5 w-3.5 text-amber-600" />
              <span>Held Carts (F7)</span>
              {heldCarts && heldCarts.length > 0 && (
                <Badge variant="accent" className="ml-1 h-4 px-1 py-0 text-[10px]">
                  {heldCarts.length}
                </Badge>
              )}
            </Button>
          </div>
        </div>

        {/* Product Search & Barcode Bar */}
        <div className="border-b border-[#d1deda] bg-white p-4">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Scan barcode or type medicine brand / generic name (Press F2 to focus)..."
              className="h-11 w-full rounded-lg border border-[#d1deda] bg-[#f8faf9] pl-10 pr-4 text-sm font-medium text-[#122A36] placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#159A72] transition-colors"
              autoFocus
            />
            {isSearching && (
              <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#159A72] border-t-transparent" />
              </div>
            )}
          </div>

          {/* Quick Keyboard Hints */}
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
            <div className="flex items-center gap-3">
              <span><kbd className="rounded bg-slate-200 px-1 py-0.5 text-[10px]">F2</kbd> Search</span>
              <span><kbd className="rounded bg-slate-200 px-1 py-0.5 text-[10px]">F8</kbd> Hold Cart</span>
              <span><kbd className="rounded bg-slate-200 px-1 py-0.5 text-[10px]">F9</kbd> Pay / Checkout</span>
              <span><kbd className="rounded bg-slate-200 px-1 py-0.5 text-[10px]">Esc</kbd> Cancel</span>
            </div>
            <span className="font-medium text-emerald-700">All prices authoritative from server</span>
          </div>
        </div>

        {/* Search Results Area */}
        <div className="flex-1 overflow-y-auto p-4">
          {searchQuery.trim().length >= 2 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                <span>Matching medicines found ({searchResults?.length || 0})</span>
                <span className="text-[11px]">Click or enter to add to cart</span>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {searchResults && searchResults.length > 0 ? (
                  searchResults.map((product) => {
                    const isOutOfStock = (product.eligibleUnits ?? 0) <= 0;
                    return (
                      <div
                        key={product.id}
                        onClick={() => !isOutOfStock && addToCart(product)}
                        className={`flex flex-col justify-between rounded-xl border p-3 transition-all select-none ${
                          isOutOfStock
                            ? 'opacity-50 bg-slate-50 border-slate-200 cursor-not-allowed'
                            : 'bg-white border-[#d1deda] hover:border-[#159A72] hover:shadow-xs cursor-pointer active:scale-[0.99]'
                        }`}
                      >
                        <div>
                          <div className="flex items-start justify-between gap-1">
                            <div>
                              <h4 className="font-bold text-[#122A36] text-sm leading-tight">
                                {product.brandName}
                              </h4>
                              <p className="text-xs text-slate-500">{product.genericName} • {product.strength || '-'}</p>
                            </div>
                            <Badge
                              variant={isOutOfStock ? 'destructive' : 'default'}
                              className="text-[10px] shrink-0"
                            >
                              {isOutOfStock ? '0 Stock' : `${product.eligibleUnits} Left`}
                            </Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                              {product.dosageForm}
                            </span>
                            {product.requiresPrescription && (
                              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200">
                                Rx Required
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
                          <span className="text-sm font-bold text-[#159A72]">
                            {formatPKR(product.sellingPriceMinor)}
                            <span className="text-[10px] font-normal text-slate-500"> / {product.baseUnit}</span>
                          </span>
                          <Button size="sm" variant="outline" className="h-7 text-xs border-[#d1deda]">
                            <Plus className="h-3 w-3" />
                            <span>Add</span>
                          </Button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="col-span-full py-12 text-center text-slate-400">
                    No products matched "{searchQuery}".
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
              <ShoppingCart className="h-12 w-12 text-slate-300 mb-3" />
              <h3 className="text-sm font-bold text-[#122A36]">Cashier Ready</h3>
              <p className="text-xs text-slate-500 max-w-sm mt-1">
                Scan barcode or search by medicine name above to populate the cart. Common shortcuts: <kbd className="rounded bg-slate-200 px-1">F2</kbd> search, <kbd className="rounded bg-slate-200 px-1">F9</kbd> checkout.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Main Right: Active Cart & Tender Summary (Width 450px) */}
      <div className="flex w-[460px] shrink-0 flex-col bg-white border-l border-[#d1deda] shadow-xs select-none">
        {/* Cart Header & Customer Selector */}
        <div className="border-b border-[#d1deda] p-4 bg-[#fbfdfc]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-[#159A72]" />
              <h3 className="font-bold text-[#122A36] text-sm">Customer Cart</h3>
              <span className="rounded-full bg-[#159A72]/15 px-2 py-0.5 text-xs font-bold text-[#159A72]">
                {cart.length}
              </span>
            </div>
            {cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                className="text-xs text-rose-600 hover:text-rose-700 font-semibold"
              >
                Clear Cart
              </button>
            )}
          </div>

          {/* Customer Selection */}
          <div className="mt-3 flex items-center gap-2">
            <User className="h-4 w-4 text-slate-400 shrink-0" />
            <select
              className="flex-1 rounded-lg border border-[#d1deda] bg-white py-1.5 px-2.5 text-xs font-medium text-[#122A36] focus:outline-none focus:ring-1 focus:ring-[#159A72]"
              value={selectedCustomer?.id || ''}
              onChange={(e) => {
                const found = customers?.items?.find((c) => c.id === e.target.value);
                setSelectedCustomer(found ? { id: found.id, name: found.name } : null);
              }}
            >
              <option value="">Walk-in Customer (No Credit)</option>
              {customers?.items?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.creditEnabled ? '(Credit OK)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Cart Items List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
              <ShoppingCart className="h-10 w-10 text-slate-200 mb-2" />
              <p className="text-xs font-semibold text-slate-600">Cart is empty</p>
              <p className="text-[11px] text-slate-400">Add medicines to generate the bill.</p>
            </div>
          ) : (
            cart.map((item, index) => {
              const lineTotal = item.unitPriceMinor * item.quantity * item.selectedMultiplier;
              return (
                <div
                  key={`${item.productId}-${item.selectedUnitName || 'base'}`}
                  className="rounded-lg border border-[#e2ece9] bg-[#fcfdfd] p-3 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h5 className="font-bold text-[#122A36] text-sm leading-tight">
                        {item.brandName}
                      </h5>
                      <p className="text-[11px] text-slate-500">{item.genericName}</p>
                    </div>
                    <button
                      onClick={() => removeFromCart(index)}
                      className="text-slate-400 hover:text-rose-600 transition-colors p-1"
                      title="Remove item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Packaging Unit & Pricing Selector */}
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    {/* Unit selector */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-500">Unit:</span>
                      <select
                        className="rounded border border-[#d1deda] bg-white py-0.5 px-1.5 text-xs font-medium text-slate-700 focus:outline-none"
                        value={item.selectedUnitName || ''}
                        onChange={(e) => changeUnit(index, e.target.value || undefined)}
                      >
                        <option value="">{item.baseUnit} (1x)</option>
                        {item.packUnits.map((pack) => (
                          <option key={pack.name} value={pack.name}>
                            {pack.name} ({pack.multiplier}x)
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Quantity controls */}
                    <div className="flex items-center gap-1 rounded-lg border border-[#d1deda] bg-white p-0.5">
                      <button
                        onClick={() => updateQuantity(index, item.quantity - 1)}
                        className="h-6 w-6 rounded flex items-center justify-center hover:bg-slate-100 text-slate-600"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateQuantity(index, parseInt(e.target.value) || 1)}
                        className="h-6 w-10 text-center font-bold text-xs text-[#122A36] focus:outline-none"
                      />
                      <button
                        onClick={() => updateQuantity(index, item.quantity + 1)}
                        className="h-6 w-6 rounded flex items-center justify-center hover:bg-slate-100 text-slate-600"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Total Price */}
                    <div className="text-right">
                      <span className="font-bold text-[#122A36] text-sm">
                        {formatPKR(lineTotal)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Cart Totals & Checkout Trigger */}
        <div className="border-t border-[#d1deda] bg-[#fbfdfc] p-4 space-y-3">
          <div className="space-y-1.5 text-xs text-slate-600">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span className="font-semibold text-slate-800">{formatPKR(calculatedSubtotalMinor)}</span>
            </div>
            {calculatedDiscountMinor > 0 && (
              <div className="flex justify-between text-emerald-700">
                <span>Discount:</span>
                <span className="font-semibold">-{formatPKR(calculatedDiscountMinor)}</span>
              </div>
            )}
            {calculatedTaxMinor > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>Sales Tax:</span>
                <span className="font-semibold">{formatPKR(calculatedTaxMinor)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold text-[#122A36] border-t border-slate-200 pt-2">
              <span>Total Payable:</span>
              <span className="text-[#159A72] text-xl font-extrabold">
                {formatPKR(calculatedTotalMinor)}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              onClick={() => {
                const label = `Cart ${new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}`;
                holdCartMutation.mutate(label);
              }}
              disabled={cart.length === 0 || holdCartMutation.isPending}
              className="border-[#d1deda] text-xs h-11"
              title="Hold this cart to serve next customer (F8)"
            >
              <Pause className="h-4 w-4" />
            </Button>
            <Button
              onClick={() => {
                if (!currentSession) {
                  setOpenSessionModal(true);
                  toast.error('Please open cash drawer session first.');
                  return;
                }
                setCashTendered((calculatedTotalMinor / 100).toFixed(2));
                setCheckoutModalOpen(true);
              }}
              disabled={cart.length === 0}
              className="flex-1 h-11 bg-[#159A72] text-white hover:bg-[#128361] font-bold text-sm gap-2"
            >
              <Receipt className="h-4 w-4" />
              <span>Checkout (F9)</span>
            </Button>
          </div>
        </div>
      </div>

      {/* MODAL 1: Open Cash Drawer Session Modal */}
      <Dialog open={openSessionModal} onOpenChange={setOpenSessionModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CircleDollarSign className="h-5 w-5 text-[#159A72]" />
              <span>Cash Drawer Management</span>
            </DialogTitle>
            <DialogDescription>
              {currentSession
                ? `You have an open session since ${formatDateTime(currentSession.openedAt)}. Opening float: ${formatPKR(currentSession.openingFloatMinor)}.`
                : 'Enter opening float amount in PKR to open your shift drawer.'}
            </DialogDescription>
          </DialogHeader>

          {!currentSession ? (
            <div className="space-y-4 py-2">
              <div>
                <label className="text-xs font-semibold text-slate-700">Opening Float (PKR)</label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-bold">Rs.</span>
                  <Input
                    type="number"
                    value={openingFloat}
                    onChange={(e) => setOpeningFloat(parseFloat(e.target.value) || 0)}
                    className="pl-10 text-base font-bold"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                {[2000, 5000, 10000].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setOpeningFloat(amt)}
                    className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Rs. {amt.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-2 text-xs">
              <div className="flex justify-between py-1 border-b">
                <span className="text-slate-500">Cashier:</span>
                <span className="font-semibold">{currentSession.cashierName || user?.name}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-slate-500">Opening Float:</span>
                <span className="font-semibold">{formatPKR(currentSession.openingFloatMinor)}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-slate-500">Cash Sales:</span>
                <span className="font-semibold text-emerald-700">{formatPKR(currentSession.cashSalesMinor)}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-slate-500">Expected Closing:</span>
                <span className="font-bold text-[#122A36]">{formatPKR(currentSession.expectedClosingMinor)}</span>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            {!currentSession ? (
              <Button
                onClick={() => openSessionMutation.mutate(openingFloat)}
                disabled={openSessionMutation.isPending || openingFloat < 0}
                className="w-full bg-[#159A72] text-white hover:bg-[#128361]"
              >
                {openSessionMutation.isPending ? 'Opening...' : 'Confirm & Open Drawer'}
              </Button>
            ) : (
              <div className="flex w-full gap-2">
                <Link href="/cash-sessions" className="flex-1">
                  <Button variant="outline" className="w-full text-xs">
                    View Drawer Ledger
                  </Button>
                </Link>
                <Button
                  variant="secondary"
                  onClick={() => setOpenSessionModal(false)}
                  className="flex-1 text-xs"
                >
                  Continue Selling
                </Button>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL 2: Payment & Checkout Confirmation Modal */}
      <Dialog open={checkoutModalOpen} onOpenChange={setCheckoutModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-[#159A72]" />
              <span>Checkout & Payment Tender</span>
            </DialogTitle>
            <DialogDescription>
              Select customer payment method and confirm transaction details.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Amount Banner */}
            <div className="rounded-xl bg-[#122A36] p-4 text-white">
              <div className="text-xs uppercase tracking-wider text-slate-300">Total Due</div>
              <div className="text-3xl font-extrabold text-[#159A72] mt-0.5">
                {formatPKR(calculatedTotalMinor)}
              </div>
              <div className="text-xs text-slate-300 mt-1">
                Items: {cart.length} • {selectedCustomer ? `Customer: ${selectedCustomer.name}` : 'Walk-in'}
              </div>
            </div>

            {/* Payment Method Selector */}
            <div>
              <label className="text-xs font-semibold text-slate-700">Payment Method</label>
              <div className="grid grid-cols-4 gap-2 mt-1">
                {[
                  { id: 'CASH', label: 'Cash', icon: Banknote },
                  { id: 'CARD', label: 'Card / POS', icon: CreditCard },
                  { id: 'MOBILE_WALLET', label: 'Wallet', icon: Smartphone },
                  { id: 'CREDIT', label: 'Customer Credit', icon: User },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPaymentMethod(item.id as any)}
                    className={`flex flex-col items-center justify-center rounded-lg border p-2.5 text-xs font-semibold transition-all ${
                      paymentMethod === item.id
                        ? 'border-[#159A72] bg-emerald-50/50 text-[#159A72] ring-1 ring-[#159A72]'
                        : 'border-[#d1deda] bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <item.icon className="h-4 w-4 mb-1" />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Cash Tender & Change Calculations */}
            {paymentMethod === 'CASH' && (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Cash Received (PKR)</label>
                  <Input
                    type="number"
                    value={cashTendered}
                    onChange={(e) => setCashTendered(e.target.value)}
                    className="mt-1 text-base font-bold"
                    placeholder="0.00"
                    autoFocus
                  />
                </div>

                {/* Quick Tender Buttons */}
                <div className="flex flex-wrap gap-1.5">
                  {[
                    Math.ceil(calculatedTotalMinor / 100),
                    500,
                    1000,
                    2000,
                    5000,
                  ].map((val, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setCashTendered(val.toString())}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Rs. {val.toLocaleString()}
                    </button>
                  ))}
                </div>

                {/* Change Due */}
                <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-sm font-bold">
                  <span className="text-slate-600">Change Due to Customer:</span>
                  <span className="text-xl font-extrabold text-[#122A36]">
                    {formatPKR(changeMinor)}
                  </span>
                </div>
              </div>
            )}

            {/* Reference for Card or Wallet */}
            {(paymentMethod === 'CARD' || paymentMethod === 'MOBILE_WALLET') && (
              <div>
                <label className="text-xs font-semibold text-slate-700">
                  Transaction / Approval Reference (Optional)
                </label>
                <Input
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  placeholder="e.g. Card slip auth code or Easypaisa/JazzCash TxID"
                  className="mt-1 text-xs"
                />
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setCheckoutModalOpen(false)}
              disabled={checkoutMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => checkoutMutation.mutate()}
              disabled={
                checkoutMutation.isPending ||
                (paymentMethod === 'CASH' && tenderedMinor < calculatedTotalMinor) ||
                (paymentMethod === 'CREDIT' && !selectedCustomer)
              }
              className="bg-[#159A72] text-white hover:bg-[#128361] font-bold"
            >
              {checkoutMutation.isPending ? 'Processing Sale...' : 'Confirm & Complete (F9)'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL 3: Held Carts Modal */}
      <Dialog open={heldModalOpen} onOpenChange={setHeldModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pause className="h-5 w-5 text-amber-600" />
              <span>Held Carts</span>
            </DialogTitle>
            <DialogDescription>
              Resume any previously suspended cart.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2 max-h-[300px] overflow-y-auto">
            {heldCarts && heldCarts.length > 0 ? (
              heldCarts.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between rounded-lg border border-[#e2ece9] p-3 text-xs"
                >
                  <div>
                    <span className="font-bold text-[#122A36]">{h.label || 'Held Cart'}</span>
                    <p className="text-slate-500">{h.lines?.length || 0} items • {formatDateTime(h.createdAt)}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => releaseHeldMutation.mutate(h.id)}
                      className="h-7 text-xs text-rose-600 border-rose-200"
                    >
                      Delete
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        // Restore held cart
                        const restored = (h.lines || []).map((l: any) => ({
                          productId: l.productId,
                          sku: l.sku || '',
                          brandName: l.name || 'Medicine',
                          genericName: '',
                          dosageForm: 'Tablet',
                          baseUnit: l.unitName || 'Unit',
                          availableUnits: 100,
                          packUnits: [],
                          selectedUnitName: l.unitName,
                          selectedMultiplier: 1,
                          quantity: l.quantity || 1,
                          unitPriceMinor: l.unitPriceMinor || 100,
                          discountMinor: l.discountMinor || 0,
                          requiresPrescription: false,
                          prescriptionVerified: true,
                        }));
                        setCart(restored);
                        releaseHeldMutation.mutate(h.id);
                        setHeldModalOpen(false);
                        toast.success('Held cart resumed.');
                      }}
                      className="h-7 text-xs bg-[#159A72] text-white hover:bg-[#128361]"
                    >
                      Resume
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-6 text-center text-xs text-slate-400">No held carts.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL 4: Printable Thermal Receipt Modal (80mm) */}
      <Dialog open={!!receiptSale} onOpenChange={() => setReceiptSale(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-emerald-600" />
              <span>Sale Complete</span>
            </DialogTitle>
            <DialogDescription>
              Official customer receipt confirmed by server.
            </DialogDescription>
          </DialogHeader>

          {/* Thermal Receipt Content Container */}
          <div className="border border-slate-200 bg-white p-4 rounded-lg">
            <div id="printable-receipt" className="font-mono text-xs text-black leading-tight space-y-2">
              {/* Receipt Header */}
              <div className="text-center pb-2 border-b border-dashed border-black">
                <div className="font-bold text-sm uppercase tracking-wide">
                  {receiptPharmacy?.name || 'Shifa Pharmacy'}
                </div>
                <div className="text-[10px]">
                  {receiptPharmacy?.address || 'Shop 4, Block C, Gulberg III, Lahore'}
                </div>
                <div className="text-[10px]">
                  Phone: {receiptPharmacy?.phone || '+92 42 3575 0000'}
                </div>
                <div className="text-[10px]">
                  Lic #: {receiptPharmacy?.license || 'PB-LHR-DEMO-0001'}
                </div>
              </div>

              {/* Receipt Metadata */}
              <div className="text-[10px] space-y-0.5 pb-2 border-b border-dashed border-black">
                <div className="flex justify-between">
                  <span>Invoice:</span>
                  <span className="font-bold">{receiptSale?.invoiceNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span>Date:</span>
                  <span>{formatDateTime(receiptSale?.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Cashier:</span>
                  <span>{receiptSale?.cashierName || user?.name}</span>
                </div>
                {receiptSale?.customerName && (
                  <div className="flex justify-between">
                    <span>Customer:</span>
                    <span>{receiptSale.customerName}</span>
                  </div>
                )}
              </div>

              {/* Line Items */}
              <div className="space-y-1 pb-2 border-b border-dashed border-black">
                <div className="flex justify-between font-bold text-[10px] pb-1">
                  <span>Item</span>
                  <span>Qty × Price</span>
                  <span>Total</span>
                </div>
                {receiptSale?.lines?.map((line, idx) => (
                  <div key={idx} className="flex justify-between text-[10px]">
                    <span className="truncate max-w-[150px]">{line.name}</span>
                    <span>{line.quantity} × {formatPKR(line.unitPriceMinor)}</span>
                    <span className="font-bold">{formatPKR(line.lineTotalMinor)}</span>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="space-y-0.5 pb-2 border-b border-dashed border-black">
                <div className="flex justify-between text-[11px]">
                  <span>Subtotal:</span>
                  <span>{formatPKR(receiptSale?.subtotalMinor)}</span>
                </div>
                {receiptSale?.discountMinor ? (
                  <div className="flex justify-between text-[11px]">
                    <span>Discount:</span>
                    <span>-{formatPKR(receiptSale.discountMinor)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between text-xs font-bold pt-1">
                  <span>TOTAL:</span>
                  <span>{formatPKR(receiptSale?.totalMinor)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span>Paid ({receiptSale?.payments?.[0]?.method || 'CASH'}):</span>
                  <span>{formatPKR(receiptSale?.paidMinor)}</span>
                </div>
                {receiptSale?.changeMinor ? (
                  <div className="flex justify-between text-[11px]">
                    <span>Change:</span>
                    <span>{formatPKR(receiptSale.changeMinor)}</span>
                  </div>
                ) : null}
              </div>

              {/* Receipt Footer */}
              <div className="text-center text-[9px] pt-1 text-slate-700">
                <p>{receiptPharmacy?.receiptFooter || 'Thank you for choosing Shifa Pharmacy. Returns accepted within 14 days with original receipt.'}</p>
                <p className="mt-1 font-bold">*** PHARMACYOS VERIFIED ***</p>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setReceiptSale(null)}
            >
              Done (Esc)
            </Button>
            <Button
              onClick={printReceipt}
              className="bg-[#159A72] text-white hover:bg-[#128361] gap-1.5"
            >
              <Printer className="h-4 w-4" />
              <span>Print Thermal Receipt</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
