import { Doc } from '../../common/types';
import { Types } from 'mongoose';

const idOf = (v: unknown) => (v && typeof v === 'object' && '_id' in (v as object) ? String((v as { _id: unknown })._id) : v ? String(v) : undefined);
const nameOf = (v: unknown) => (v && typeof v === 'object' && 'name' in (v as object) ? (v as { name: string }).name : undefined);

export function toSaleDto(s: Doc, payments?: Doc[]) {
  const lines = s.lines as Array<Record<string, unknown>>;
  return {
    id: String(s._id),
    invoiceNumber: s.invoiceNumber,
    cashierId: idOf(s.cashierId),
    cashierName: nameOf(s.cashierId),
    customerId: idOf(s.customerId),
    customerName: nameOf(s.customerId),
    cashSessionId: s.cashSessionId ? String(s.cashSessionId) : undefined,
    lines: lines.map((l, index) => ({
      lineIndex: index,
      productId: idOf(l.productId),
      sku: l.sku,
      name: l.name,
      unitName: l.unitName,
      unitMultiplier: l.unitMultiplier,
      quantity: l.quantity,
      quantityUnits: l.quantityUnits,
      unitPriceMinor: l.unitPriceMinor,
      discountMinor: l.discountMinor,
      taxRateBps: l.taxRateBps,
      taxMinor: l.taxMinor,
      lineTotalMinor: l.lineTotalMinor,
      costBasisMinor: l.costBasisMinor,
      returnedUnits: l.returnedUnits ?? 0,
      returnableUnits: (l.quantityUnits as number) - ((l.returnedUnits as number) ?? 0),
      prescriptionVerified: l.prescriptionVerified,
      allocations: (l.allocations as Array<Record<string, unknown>>).map((a) => ({ ...a, batchId: String(a.batchId) })),
    })),
    subtotalMinor: s.subtotalMinor,
    discountMinor: s.discountMinor,
    taxMinor: s.taxMinor,
    totalMinor: s.totalMinor,
    costMinor: s.costMinor,
    paidMinor: s.paidMinor,
    changeMinor: s.changeMinor,
    paymentStatus: s.paymentStatus,
    status: s.status,
    notes: s.notes,
    payments: payments?.map((p) => ({ id: String(p._id), method: p.method, amountMinor: p.amountMinor, status: p.status, reference: p.reference, refundOfPaymentId: p.refundOfPaymentId ? String(p.refundOfPaymentId) : undefined, createdAt: p.createdAt })),
    createdAt: s.createdAt,
  };
}

export function toReturnDto(r: Doc) {
  const lines = r.lines as Array<Record<string, unknown>>;
  const sale = r.saleId as { _id?: Types.ObjectId; invoiceNumber?: string } | Types.ObjectId;
  return {
    id: String(r._id),
    returnNumber: r.returnNumber,
    saleId: idOf(sale),
    invoiceNumber: (sale as { invoiceNumber?: string })?.invoiceNumber,
    lines: lines.map((l) => ({ ...l, productId: String(l.productId), batchId: String(l.batchId) })),
    refundMinor: r.refundMinor,
    refundMethod: r.refundMethod,
    reason: r.reason,
    status: r.status,
    requestedById: idOf(r.requestedById),
    requestedByName: nameOf(r.requestedById),
    approvedById: idOf(r.approvedById),
    approvedByName: nameOf(r.approvedById),
    approvedAt: r.approvedAt,
    rejectionReason: r.rejectionReason,
    createdAt: r.createdAt,
  };
}
