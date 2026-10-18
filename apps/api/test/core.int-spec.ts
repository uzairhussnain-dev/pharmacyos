import { randomUUID } from 'node:crypto';
import { createTestApp, futureDate, TestContext } from './test-app';

/**
 * End-to-end domain flow through the HTTP API:
 * product → supplier → PO → GRN (stock in) → cash session → checkout (idempotent, concurrent-safe)
 * → return → cash close/reconcile → audit → reconciliation checks.
 */
describe('Core domain integration', () => {
  let t: TestContext;
  let owner: string;
  let cashier: string;
  let cashierId: string;
  let productId: string;
  let supplierId: string;
  let poId: string;

  beforeAll(async () => {
    t = await createTestApp(`int_core_${Date.now()}`);
    await t.createUser('owner', 'OWNER');
    cashierId = await t.createUser('cashier1', 'CASHIER');
    owner = await t.login('owner');
    cashier = await t.login('cashier1');
  }, 120_000);

  afterAll(async () => {
    await t.close();
  });

  it('rejects unauthenticated and under-privileged requests', async () => {
    await t.http().get('/api/v1/products').expect(401);
    const res = await t.http().post('/api/v1/users').set(t.auth(cashier)).send({ name: 'x', username: 'xyz', password: 'Password123', role: 'OWNER' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('creates a product and enforces SKU/barcode uniqueness', async () => {
    const dto = { sku: 'PAN-500', barcode: '8964000000011', brandName: 'Panadol', genericName: 'Paracetamol', strength: '500mg', dosageForm: 'Tablet', category: 'Analgesic', baseUnit: 'Tablet', packUnits: [{ name: 'Strip', multiplier: 10, barcode: '8964000000028' }], sellingPriceMinor: 250, reorderLevel: 50, leadTimeDays: 3 };
    const res = await t.http().post('/api/v1/products').set(t.auth(owner)).send(dto).expect(201);
    productId = res.body.id;
    expect(res.body.sku).toBe('PAN-500');

    const dup = await t.http().post('/api/v1/products').set(t.auth(owner)).send({ ...dto, sku: 'OTHER' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE_KEY');

    const lookup = await t.http().get('/api/v1/products/lookup?barcode=8964000000028').set(t.auth(cashier)).expect(200);
    expect(lookup.body.product.id).toBe(productId);
    expect(lookup.body.matchedPackUnit).toBe('Strip');
  });

  it('purchase orders do not change stock; accepted goods receipts do, via the ledger', async () => {
    const sup = await t.http().post('/api/v1/suppliers').set(t.auth(owner)).send({ name: 'Getz Distributors', leadTimeDays: 3, paymentTermsDays: 30 }).expect(201);
    supplierId = sup.body.id;

    const po = await t.http().post('/api/v1/purchase-orders').set(t.auth(owner)).send({ supplierId, lines: [{ productId, quantityUnits: 100, unitCostMinor: 150 }] }).expect(201);
    poId = po.body.id;
    expect(po.body.status).toBe('DRAFT');
    let p = await t.http().get(`/api/v1/products/${productId}`).set(t.auth(owner)).expect(200);
    expect(p.body.onHandUnits).toBe(0);

    await t.http().post(`/api/v1/purchase-orders/${poId}/submit`).set(t.auth(owner)).expect(201);
    // Over-receipt is rejected
    const over = await t.http().post(`/api/v1/purchase-orders/${poId}/receive`).set(t.auth(owner)).send({ lines: [{ productId, batchNumber: 'b1', expiryDate: futureDate(365), quantityUnits: 101, unitCostMinor: 150 }] });
    expect(over.status).toBe(422);
    // Expired stock cannot be received
    const expired = await t.http().post(`/api/v1/purchase-orders/${poId}/receive`).set(t.auth(owner)).send({ lines: [{ productId, batchNumber: 'bx', expiryDate: '2020-01-01', quantityUnits: 10, unitCostMinor: 150 }] });
    expect(expired.body.code).toBe('BATCH_INELIGIBLE');

    // Two batches: one expiring sooner (FEFO should pick it first)
    const grn = await t.http().post(`/api/v1/purchase-orders/${poId}/receive`).set(t.auth(owner)).send({
      lines: [
        { productId, batchNumber: 'late', expiryDate: futureDate(400), quantityUnits: 60, unitCostMinor: 150 },
        { productId, batchNumber: 'soon', expiryDate: futureDate(120), quantityUnits: 40, unitCostMinor: 140 },
      ],
      supplierInvoiceNumber: 'GTZ-001',
    }).expect(201);
    expect(grn.body.purchaseOrder.status).toBe('RECEIVED');
    expect(grn.body.receipt.lines).toHaveLength(2);

    p = await t.http().get(`/api/v1/products/${productId}`).set(t.auth(owner)).expect(200);
    expect(p.body.onHandUnits).toBe(100);
    expect(p.body.eligibleUnits).toBe(100);

    const moves = await t.http().get(`/api/v1/inventory/movements?productId=${productId}`).set(t.auth(owner)).expect(200);
    expect(moves.body.total).toBe(2);
    expect(moves.body.items.every((m: { type: string }) => m.type === 'RECEIPT')).toBe(true);
  });

  it('refuses checkout without an open cash session', async () => {
    const res = await t.http().post('/api/v1/pos/sales').set(t.auth(cashier)).send({ idempotencyKey: randomUUID(), lines: [{ productId, quantity: 1 }], tenders: [{ method: 'CASH', amountMinor: 1000 }] });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NO_OPEN_CASH_SESSION');
  });

  let saleId: string;
  let firstInvoice: string;

  it('performs an idempotent FEFO checkout and records payment, movements and audit', async () => {
    await t.http().post('/api/v1/cash-sessions/open').set(t.auth(cashier)).send({ openingFloatMinor: 500000 }).expect(201);
    const dupOpen = await t.http().post('/api/v1/cash-sessions/open').set(t.auth(cashier)).send({ openingFloatMinor: 1 });
    expect(dupOpen.body.code).toBe('CASH_SESSION_ALREADY_OPEN');

    const quote = await t.http().post('/api/v1/pos/sales/quote').set(t.auth(cashier)).send({ lines: [{ productId, unitName: 'Strip', quantity: 5 }] }).expect(200);
    expect(quote.body.totalMinor).toBe(5 * 10 * 250);
    expect(quote.body.availability[productId].sufficient).toBe(true);

    const key = randomUUID();
    const body = { idempotencyKey: key, lines: [{ productId, unitName: 'Strip', quantity: 5 }], tenders: [{ method: 'CASH', amountMinor: 13000 }] };
    const first = await t.http().post('/api/v1/pos/sales').set(t.auth(cashier)).send(body);
    if (first.status !== 201) console.log('CHECKOUT FAILED', JSON.stringify(first.body));
    expect(first.status).toBe(201);
    saleId = first.body.id;
    firstInvoice = first.body.invoiceNumber;
    expect(first.body.totalMinor).toBe(12500);
    expect(first.body.changeMinor).toBe(500);
    expect(first.body.replayed).toBe(false);
    // FEFO: 50 units all from the 'soon' batch (40) then 10 from 'late'
    const allocs = first.body.lines[0].allocations;
    expect(allocs.map((a: { batchNumber: string; quantityUnits: number }) => [a.batchNumber, a.quantityUnits])).toEqual([['SOON', 40], ['LATE', 10]]);
    expect(first.body.costMinor).toBe(40 * 140 + 10 * 150);

    // Retry with the same key → same invoice, no new sale
    const retry = await t.http().post('/api/v1/pos/sales').set(t.auth(cashier)).send(body).expect(201);
    expect(retry.body.invoiceNumber).toBe(firstInvoice);
    expect(retry.body.replayed).toBe(true);

    // Same key, different payload → rejected
    const mismatch = await t.http().post('/api/v1/pos/sales').set(t.auth(cashier)).send({ ...body, tenders: [{ method: 'CASH', amountMinor: 20000 }] });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.code).toBe('IDEMPOTENCY_MISMATCH');

    const sales = await t.http().get('/api/v1/sales').set(t.auth(owner)).expect(200);
    expect(sales.body.total).toBe(1);

    const p = await t.http().get(`/api/v1/products/${productId}`).set(t.auth(owner)).expect(200);
    expect(p.body.onHandUnits).toBe(50);

    const session = await t.http().get('/api/v1/cash-sessions/current').set(t.auth(cashier)).expect(200);
    expect(session.body.cashSalesMinor).toBe(12500);
    expect(session.body.expectedClosingMinor).toBe(500000 + 12500);

    const audit = await t.http().get('/api/v1/audit-logs?action=sale.checkout').set(t.auth(owner)).expect(200);
    expect(audit.body.total).toBe(1);
    expect(audit.body.items[0].entityId).toBe(saleId);
  });

  it('rejects cashier discounts beyond permission and under-tendered payments', async () => {
    const noPerm = await t.http().post('/api/v1/pos/sales').set(t.auth(cashier)).send({ idempotencyKey: randomUUID(), lines: [{ productId, quantity: 1, discountMinor: 10 }], tenders: [{ method: 'CASH', amountMinor: 250 }] });
    expect(noPerm.body.code).toBe('DISCOUNT_NOT_ALLOWED');
    const short = await t.http().post('/api/v1/pos/sales').set(t.auth(cashier)).send({ idempotencyKey: randomUUID(), lines: [{ productId, quantity: 1 }], tenders: [{ method: 'CASH', amountMinor: 100 }] });
    expect(short.body.code).toBe('PAYMENT_MISMATCH');
    // Failed attempts release their idempotency key so the same key can be retried after fixing the request
    const key = randomUUID();
    await t.http().post('/api/v1/pos/sales').set(t.auth(cashier)).send({ idempotencyKey: key, lines: [{ productId, quantity: 1 }], tenders: [{ method: 'CASH', amountMinor: 100 }] }).expect(422);
    await t.http().post('/api/v1/pos/sales').set(t.auth(cashier)).send({ idempotencyKey: key, lines: [{ productId, quantity: 1 }], tenders: [{ method: 'CASH', amountMinor: 250 }] }).expect(201);
  });

  it('never oversells under concurrency: 49 units left, 8 cashiers want 10 each → exactly 4 succeed', async () => {
    // Give every attempt its own cashier with an open session so they are truly independent actors.
    const tokens: string[] = [];
    for (let i = 0; i < 8; i++) {
      await t.createUser(`racer${i}`, 'CASHIER');
      const tok = await t.login(`racer${i}`);
      await t.http().post('/api/v1/cash-sessions/open').set(t.auth(tok)).send({ openingFloatMinor: 0 }).expect(201);
      tokens.push(tok);
    }
    const before = await t.http().get(`/api/v1/products/${productId}`).set(t.auth(owner));
    const available = before.body.eligibleUnits as number; // 49
    expect(available).toBe(49);

    const results = await Promise.all(
      tokens.map((tok) => t.http().post('/api/v1/pos/sales').set(t.auth(tok)).send({ idempotencyKey: randomUUID(), lines: [{ productId, quantity: 10 }], tenders: [{ method: 'CASH', amountMinor: 2500 }] })),
    );
    const ok = results.filter((r) => r.status === 201);
    const failed = results.filter((r) => r.status !== 201);
    expect(ok).toHaveLength(Math.floor(available / 10));
    expect(failed.every((r) => r.body.code === 'INSUFFICIENT_STOCK')).toBe(true);

    const after = await t.http().get(`/api/v1/products/${productId}`).set(t.auth(owner));
    expect(after.body.onHandUnits).toBe(available - ok.length * 10);

    // Ledger invariant holds
    const recon = await t.http().get('/api/v1/reconciliation/run').set(t.auth(owner)).expect(200);
    expect(recon.body.discrepancies.filter((d: { check: string }) => ['BATCH_BALANCE', 'SALE_MOVEMENTS', 'SALE_PAYMENTS'].includes(d.check))).toEqual([]);
  });

  it('rolls back the whole checkout when one line cannot be allocated', async () => {
    const other = await t.http().post('/api/v1/products').set(t.auth(owner)).send({ sku: 'EMPTY-1', brandName: 'Nothing', genericName: 'None', dosageForm: 'Tablet', category: 'Misc', baseUnit: 'Tablet', sellingPriceMinor: 100 }).expect(201);
    const before = (await t.http().get(`/api/v1/products/${productId}`).set(t.auth(owner))).body.onHandUnits;
    const res = await t.http().post('/api/v1/pos/sales').set(t.auth(cashier)).send({ idempotencyKey: randomUUID(), lines: [{ productId, quantity: 1 }, { productId: other.body.id, quantity: 1 }], tenders: [{ method: 'CASH', amountMinor: 1000 }] });
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
    const after = (await t.http().get(`/api/v1/products/${productId}`).set(t.auth(owner))).body.onHandUnits;
    expect(after).toBe(before); // first line's deduction was rolled back
  });

  it('returns are linked, capped at sold quantity, restock via the ledger and refund via a negative payment', async () => {
    const tooMany = await t.http().post(`/api/v1/sales/${saleId}/returns`).set(t.auth(cashier)).send({ lines: [{ lineIndex: 0, quantityUnits: 51, disposition: 'RESTOCK' }], reason: 'Customer changed mind', refundMethod: 'CASH' });
    expect(tooMany.body.code).toBe('RETURN_EXCEEDS_SOLD');

    // Cashier requests → pending approval (no stock change yet)
    const req = await t.http().post(`/api/v1/sales/${saleId}/returns`).set(t.auth(cashier)).send({ lines: [{ lineIndex: 0, quantityUnits: 10, disposition: 'RESTOCK' }], reason: 'Unopened strip returned', refundMethod: 'CASH' }).expect(201);
    expect(req.body.status).toBe('PENDING_APPROVAL');
    expect(req.body.refundMinor).toBe(2500);
    const mid = (await t.http().get(`/api/v1/products/${productId}`).set(t.auth(owner))).body.onHandUnits;

    // Owner approves (needs an open cash session for the cash refund)
    await t.http().post('/api/v1/cash-sessions/open').set(t.auth(owner)).send({ openingFloatMinor: 10000 }).expect(201);
    const approved = await t.http().post(`/api/v1/sales/${saleId}/returns/${req.body.id}/approve`).set(t.auth(owner)).expect(201);
    expect(approved.body.status).toBe('APPROVED');

    const after = (await t.http().get(`/api/v1/products/${productId}`).set(t.auth(owner))).body.onHandUnits;
    expect(after).toBe(mid + 10);

    const sale = await t.http().get(`/api/v1/sales/${saleId}`).set(t.auth(owner)).expect(200);
    expect(sale.body.status).toBe('PARTIALLY_RETURNED');
    expect(sale.body.paymentStatus).toBe('PARTIALLY_REFUNDED');
    expect(sale.body.lines[0].returnedUnits).toBe(10);
    const refund = sale.body.payments.find((p: { amountMinor: number }) => p.amountMinor < 0);
    expect(refund.amountMinor).toBe(-2500);
    expect(refund.refundOfPaymentId).toBeDefined();
    expect(sale.body.returns).toHaveLength(1);

    // Receipt reprint is a read
    const receipt = await t.http().get(`/api/v1/sales/${firstInvoice}/receipt`).set(t.auth(cashier)).expect(200);
    expect(receipt.body.sale.invoiceNumber).toBe(firstInvoice);
    expect((await t.http().get('/api/v1/sales').set(t.auth(owner))).body.total).toBeGreaterThanOrEqual(1);
  });

  it('closes and reconciles the cash session with variance, separation of duties enforced', async () => {
    const cur = await t.http().get('/api/v1/cash-sessions/current').set(t.auth(cashier)).expect(200);
    const expected = cur.body.expectedClosingMinor as number;
    const closed = await t.http().post(`/api/v1/cash-sessions/${cur.body.id}/close`).set(t.auth(cashier)).send({ countedClosingMinor: expected - 100 }).expect(201);
    expect(closed.body.status).toBe('CLOSED');
    expect(closed.body.varianceMinor).toBe(-100);

    const selfRecon = await t.http().post(`/api/v1/cash-sessions/${cur.body.id}/reconcile`).set(t.auth(cashier)).send({});
    expect(selfRecon.status).toBe(403);

    const recon = await t.http().post(`/api/v1/cash-sessions/${cur.body.id}/reconcile`).set(t.auth(owner)).send({ notes: 'Rs 1 short, accepted' }).expect(201);
    expect(recon.body.status).toBe('RECONCILED');

    const audit = await t.http().get(`/api/v1/audit-logs?entityType=CashSession&entityId=${cur.body.id}`).set(t.auth(owner)).expect(200);
    expect(audit.body.items.map((a: { action: string }) => a.action).sort()).toEqual(['cash_session.close', 'cash_session.open', 'cash_session.reconcile']);
  });

  it('purchase returns finalize through the ledger and reports reflect persisted data', async () => {
    const batches = await t.http().get(`/api/v1/inventory/batches?productId=${productId}`).set(t.auth(owner)).expect(200);
    const late = batches.body.items.find((b: { batchNumber: string }) => b.batchNumber === 'LATE');
    const pr = await t.http().post('/api/v1/purchase-returns').set(t.auth(owner)).send({ supplierId, lines: [{ batchId: late.id, quantityUnits: 5 }], reason: 'Damaged packaging' }).expect(201);
    const before = (await t.http().get(`/api/v1/products/${productId}`).set(t.auth(owner))).body.onHandUnits;
    await t.http().post(`/api/v1/purchase-returns/${pr.body.id}/finalize`).set(t.auth(owner)).expect(201);
    const after = (await t.http().get(`/api/v1/products/${productId}`).set(t.auth(owner))).body.onHandUnits;
    expect(after).toBe(before - 5);

    const gp = await t.http().get('/api/v1/reports/gross-profit').set(t.auth(owner)).expect(200);
    expect(gp.body.grossSalesMinor).toBeGreaterThan(0);
    expect(gp.body.cogsMinor).toBeGreaterThan(0);
    expect(gp.body.returnsMinor).toBe(2500);
    expect(gp.body.grossProfitMinor).toBe(gp.body.netSalesMinor - gp.body.cogsMinor);

    const inv = await t.http().get('/api/v1/inventory/summary').set(t.auth(owner)).expect(200);
    expect(inv.body.inventoryCostValueMinor).toBeGreaterThan(0);

    const summary = await t.http().get('/api/v1/inventory/counts').set(t.auth(owner)).expect(200);
    expect(summary.body.total).toBe(0);
  });

  it('stock counts: discrepancy approval posts COUNT_ADJUSTMENT and requires a different approver', async () => {
    const stock = await t.createUser('stocky', 'STOCK_MANAGER');
    void stock;
    const stockTok = await t.login('stocky');
    const batches = await t.http().get(`/api/v1/inventory/batches?productId=${productId}&inStock=true`).set(t.auth(owner)).expect(200);
    const b = batches.body.items[0];
    const count = await t.http().post('/api/v1/inventory/counts').set(t.auth(stockTok)).send({ lines: [{ batchId: b.id, countedUnits: b.onHandUnits - 2, note: 'Two broken' }] }).expect(201);
    expect(count.body.discrepancies).toBe(1);
    await t.http().post(`/api/v1/inventory/counts/${count.body.id}/submit`).set(t.auth(stockTok)).expect(201);
    // Stock manager lacks approve permission
    await t.http().post(`/api/v1/inventory/counts/${count.body.id}/approve`).set(t.auth(stockTok)).expect(403);
    const approved = await t.http().post(`/api/v1/inventory/counts/${count.body.id}/approve`).set(t.auth(owner)).expect(201);
    expect(approved.body.status).toBe('APPROVED');
    const batch = await t.http().get(`/api/v1/inventory/batches/${b.id}`).set(t.auth(owner)).expect(200);
    expect(batch.body.onHandUnits).toBe(b.onHandUnits - 2);
    expect(batch.body.movements[0].type).toBe('COUNT_ADJUSTMENT');
    expect(batch.body.movements[0].quantityUnits).toBe(-2);
  });

  it('intelligence engine produces evidence-backed alerts and the assistant answers from tools', async () => {
    const rebuilt = await t.http().post('/api/v1/intelligence/forecast/rebuild').set(t.auth(owner)).expect(201);
    expect(rebuilt.body.created + rebuilt.body.updated).toBeGreaterThanOrEqual(0);
    const actions = await t.http().get('/api/v1/intelligence/actions').set(t.auth(owner)).expect(200);
    for (const a of actions.body.items) {
      expect(a.explanation.length).toBeGreaterThan(10);
      expect(a.recommendedActions.length).toBeGreaterThan(0);
      expect(a.evidence).toBeDefined();
    }
    const ask = await t.http().post('/api/v1/intelligence/assistant/query').set(t.auth(owner)).send({ question: 'Which products are at risk of running out?' }).expect(201);
    expect(ask.body.tools[0].tool).toBe('stockout_risk');
    expect(ask.body.narrativeSource).toBe('rules');
    // Cashier cannot use intelligence
    await t.http().post('/api/v1/intelligence/assistant/query').set(t.auth(cashier)).send({ question: 'profit?' }).expect(403);
  });

  it('health endpoints are public', async () => {
    await t.http().get('/api/v1/health').expect(200);
    const ready = await t.http().get('/api/v1/ready').expect(200);
    expect(ready.body.database).toBe('connected');
  });
});
