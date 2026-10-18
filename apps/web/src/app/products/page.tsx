'use client';

import React, { useState } from 'react';
import {
  Pill,
  Search,
  Plus,
  Filter,
  Barcode,
  Edit2,
  Check,
  AlertCircle,
  Package,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/shell/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { api } from '@/lib/api-client';
import { formatPKR, formatDate } from '@/lib/utils';
import { toast } from 'sonner';
import type { ProductDto } from '@pharmacy-os/shared-types';

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);

  // Create/Edit modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductDto | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    sku: '',
    barcode: '',
    brandName: '',
    genericName: '',
    strength: '',
    dosageForm: 'Tablet',
    category: 'Analgesic',
    baseUnit: 'Tablet',
    sellingPriceMajor: 10,
    reorderLevel: 50,
    reorderQuantity: 100,
    requiresPrescription: false,
    saleRestriction: 'OTC',
  });

  // Fetch categories
  const { data: categories } = useQuery({
    queryKey: ['products-categories'],
    queryFn: () => api.products.categories(),
  });

  // Fetch paginated products
  const { data: productsData, isLoading } = useQuery({
    queryKey: ['products-list', search, category, page],
    queryFn: () =>
      api.products.list({
        search: search || undefined,
        category: category || undefined,
        page,
        pageSize: 15,
      }),
  });

  // Save product mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        sku: formData.sku,
        barcode: formData.barcode || undefined,
        brandName: formData.brandName,
        genericName: formData.genericName,
        strength: formData.strength || undefined,
        dosageForm: formData.dosageForm,
        category: formData.category,
        baseUnit: formData.baseUnit,
        sellingPriceMinor: Math.round(formData.sellingPriceMajor * 100),
        reorderLevel: Number(formData.reorderLevel),
        reorderQuantity: Number(formData.reorderQuantity),
        requiresPrescription: formData.requiresPrescription,
        saleRestriction: formData.saleRestriction,
        taxClass: 'EXEMPT',
        taxRateBps: 0,
        packUnits: [],
        leadTimeDays: 3,
      };

      if (editingProduct) {
        return api.products.update(editingProduct.id, payload);
      } else {
        return api.products.create(payload);
      }
    },
    onSuccess: () => {
      toast.success(editingProduct ? 'Product updated successfully' : 'Product created successfully');
      setIsModalOpen(false);
      setEditingProduct(null);
      queryClient.invalidateQueries({ queryKey: ['products-list'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to save product');
    },
  });

  const openCreateModal = () => {
    setEditingProduct(null);
    setFormData({
      sku: '',
      barcode: '',
      brandName: '',
      genericName: '',
      strength: '',
      dosageForm: 'Tablet',
      category: categories?.[0] || 'Analgesic',
      baseUnit: 'Tablet',
      sellingPriceMajor: 10,
      reorderLevel: 50,
      reorderQuantity: 100,
      requiresPrescription: false,
      saleRestriction: 'OTC',
    });
    setIsModalOpen(true);
  };

  const openEditModal = (p: ProductDto) => {
    setEditingProduct(p);
    setFormData({
      sku: p.sku,
      barcode: p.barcode || '',
      brandName: p.brandName,
      genericName: p.genericName,
      strength: p.strength || '',
      dosageForm: p.dosageForm,
      category: p.category,
      baseUnit: p.baseUnit,
      sellingPriceMajor: p.sellingPriceMinor / 100,
      reorderLevel: p.reorderLevel,
      reorderQuantity: p.reorderQuantity,
      requiresPrescription: p.requiresPrescription,
      saleRestriction: p.saleRestriction,
    });
    setIsModalOpen(true);
  };

  return (
    <AppShell>
      <div className="space-y-5">
        {/* Header and Controls */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#122A36]">Product Formulations</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Community pharmacy catalogue with generics, dosages, units, and FEFO safety thresholds.
            </p>
          </div>
          <Button onClick={openCreateModal} className="gap-2 bg-[#159A72] text-white hover:bg-[#128361]">
            <Plus className="h-4 w-4" />
            <span>Add Medicine</span>
          </Button>
        </div>

        {/* Filter Bar */}
        <Card className="border-[#d1deda]">
          <CardContent className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search by brand name, generic name, or SKU..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="pl-9 text-xs"
                />
              </div>
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-slate-400" />
                <select
                  className="rounded-lg border border-[#d1deda] bg-white py-1.5 px-3 text-xs font-medium text-[#122A36] focus:outline-none focus:ring-1 focus:ring-[#159A72]"
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All Categories ({categories?.length || 0})</option>
                  {categories?.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Products Table */}
        <Card className="border-[#d1deda]">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product / Brand</TableHead>
                  <TableHead>Generic & Strength</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Base Unit</TableHead>
                  <TableHead className="text-right">Price (PKR)</TableHead>
                  <TableHead className="text-center">Stock (FEFO)</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-xs text-slate-400">
                      Loading products...
                    </TableCell>
                  </TableRow>
                ) : productsData?.items && productsData.items.length > 0 ? (
                  productsData.items.map((product) => {
                    const isLow = (product.eligibleUnits ?? 0) <= product.reorderLevel;
                    return (
                      <TableRow key={product.id}>
                        <TableCell>
                          <div className="font-bold text-[#122A36]">{product.brandName}</div>
                          <div className="text-[11px] font-mono text-slate-500">
                            SKU: {product.sku} {product.barcode ? `• Barcode: ${product.barcode}` : ''}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs text-slate-700">{product.genericName}</div>
                          <div className="text-[11px] text-slate-400">{product.strength || '-'} • {product.dosageForm}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] font-medium">
                            {product.category}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-slate-600">{product.baseUnit}</span>
                          {product.packUnits && product.packUnits.length > 0 && (
                            <span className="text-[10px] text-slate-400 block">
                              +{product.packUnits.map((u) => u.name).join(', ')}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-bold text-[#159A72]">
                          {formatPKR(product.sellingPriceMinor)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={isLow ? 'destructive' : 'default'}
                            className="text-[11px] font-bold"
                          >
                            {product.eligibleUnits ?? 0} {product.baseUnit}s
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {product.requiresPrescription ? (
                            <Badge variant="warning" className="text-[10px]">
                              Rx Required
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">
                              OTC
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditModal(product)}
                            className="h-8 w-8 p-0 text-slate-500 hover:text-[#159A72]"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-xs text-slate-400">
                      No medicines match the selected filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {/* Pagination */}
            {productsData && productsData.total > 15 && (
              <div className="flex items-center justify-between border-t border-[#d1deda] p-3 text-xs text-slate-500">
                <span>
                  Showing {productsData.items.length} of {productsData.total} products
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                    className="h-7 text-xs border-[#d1deda]"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page * 15 >= productsData.total}
                    onClick={() => setPage(page + 1)}
                    className="h-7 text-xs border-[#d1deda]"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Create/Edit Product Modal */}
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>
                {editingProduct ? 'Edit Medicine Formulation' : 'Register New Medicine'}
              </DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-4 py-2 text-xs">
              <div>
                <label className="font-semibold text-slate-700">Brand Name</label>
                <Input
                  value={formData.brandName}
                  onChange={(e) => setFormData({ ...formData, brandName: e.target.value })}
                  placeholder="e.g. Panadol"
                  className="mt-1 text-xs"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Generic Formula</label>
                <Input
                  value={formData.genericName}
                  onChange={(e) => setFormData({ ...formData, genericName: e.target.value })}
                  placeholder="e.g. Paracetamol"
                  className="mt-1 text-xs"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">SKU Code</label>
                <Input
                  value={formData.sku}
                  onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                  placeholder="e.g. PAN-500"
                  className="mt-1 text-xs"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Barcode (GTIN)</label>
                <Input
                  value={formData.barcode}
                  onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                  placeholder="e.g. 8964000100001"
                  className="mt-1 text-xs"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Dosage Strength</label>
                <Input
                  value={formData.strength}
                  onChange={(e) => setFormData({ ...formData, strength: e.target.value })}
                  placeholder="e.g. 500mg"
                  className="mt-1 text-xs"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Dosage Form</label>
                <select
                  value={formData.dosageForm}
                  onChange={(e) => setFormData({ ...formData, dosageForm: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-[#d1deda] bg-white p-2 text-xs"
                >
                  {['Tablet', 'Capsule', 'Syrup', 'Injection', 'Sachet', 'Ointment', 'Cream', 'Dressing'].map(
                    (form) => (
                      <option key={form} value={form}>
                        {form}
                      </option>
                    )
                  )}
                </select>
              </div>
              <div>
                <label className="font-semibold text-slate-700">Category</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-[#d1deda] bg-white p-2 text-xs"
                >
                  {categories?.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-semibold text-slate-700">Base Selling Unit</label>
                <Input
                  value={formData.baseUnit}
                  onChange={(e) => setFormData({ ...formData, baseUnit: e.target.value })}
                  placeholder="e.g. Tablet, Bottle"
                  className="mt-1 text-xs"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Selling Price per Unit (PKR)</label>
                <Input
                  type="number"
                  step="0.1"
                  value={formData.sellingPriceMajor}
                  onChange={(e) => setFormData({ ...formData, sellingPriceMajor: parseFloat(e.target.value) || 0 })}
                  className="mt-1 text-xs font-bold"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Safety Reorder Level</label>
                <Input
                  type="number"
                  value={formData.reorderLevel}
                  onChange={(e) => setFormData({ ...formData, reorderLevel: parseInt(e.target.value) || 0 })}
                  className="mt-1 text-xs"
                />
              </div>
              <div className="col-span-2 flex items-center gap-4 pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.requiresPrescription}
                    onChange={(e) => setFormData({ ...formData, requiresPrescription: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-[#159A72]"
                  />
                  <span className="font-medium text-slate-700">Prescription Required (Rx)</span>
                </label>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !formData.brandName || !formData.sku}
                className="bg-[#159A72] text-white hover:bg-[#128361]"
              >
                {saveMutation.isPending ? 'Saving...' : 'Save Medicine'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
