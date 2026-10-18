import { randomUUID } from 'node:crypto';
import { createTestApp, futureDate, TestContext } from './test-app';

describe('PharmacyOS End-to-End Workflows & Business Rules Verification', () => {
  let t: TestContext;
  let ownerToken: string;
  let managerToken: string;
  let pharmacistToken: string;
  let cashierToken: string;
  let cashierId: string;
  let stockManagerToken: string;

  beforeAll(async () => {
    t = await createTestApp(`e2e_workflows_${Date.now()}`);
    await t.createUser('owner_user', 'OWNER');
    await t.createUser('manager_user', 'MANAGER');
    await t.createUser('pharmacist_user', 'PHARMACIST');
    cashierId = await t.createUser('cashier_user', 'CASHIER');
    await t.createUser('stock_user', 'STOCK_MANAGER');

    ownerToken = await t.login('owner_user');
    managerToken = await t.login('manager_user');
    pharmacistToken = await t.login('pharmacist_user');
    cashierToken = await t.login('cashier_user');
    stockManagerToken = await t.login('stock_user');
  }, 120_000);

  afterAll(async () => {
    await t.close();
  });

  // ==========================================
  // Workflow A — Purchase and receive stock
  // ==========================================
  describe('Workflow A: Purchase and Receive Stock', () => {
    let supplierId: string;
    let productId: string;
    let poId: string;

    it('creates supplier and medicine catalog item', async () => {
      // 1. Create supplier
      const suppRes = await t
        .http()
        .post('/api/v1/suppliers')
        .set(t.auth(managerToken))
        .send({
          name: 'Shaheen Distributors',
          phone: '0300-9876543',
          contactName: 'Zahid Khan',
          email: 'zahid@shaheen.pk',
          paymentTermsDays: 30,
        })
        .expect(201);

      supplierId = suppRes.body.id;
      expect(supplierId).toBeDefined();

      // 2. Create product
      const prodRes = await t
        .http()
        .post('/api/v1/products')
        .set(t.auth(managerToken))
        .send({
          sku: 'AMX-250',
          barcode: '8964000999011',
          brandName: 'Amoxil Syrup',
          genericName: 'Amoxicillin',
          strength: '125mg/5ml',
          dosageForm: 'Syrup',
          category: 'Antibiotic',
          baseUnit: 'Bottle',
          sellingPriceMinor: 14500, // PKR 145.00
          reorderLevel: 20,
          reorderQuantity: 50,
          leadTimeDays: 3,
        })
        .expect(201);

      productId = prodRes.body.id;
      expect(productId).toBeDefined();
    });

    it('creates and submits a Purchase Order', async () => {
      const poRes = await t
        .http()
        .post('/api/v1/purchase-orders')
        .set(t.auth(managerToken))
        .send({
          supplierId,
          lines: [{ productId, quantityUnits: 100, unitCostMinor: 10000 }], // Cost: Rs. 100
          expectedDeliveryDate: futureDate(5),
        })
        .expect(201);

      poId = poRes.body.id;
      expect(poRes.body.status).toBe('DRAFT');
      expect(poRes.body.totalMinor).toBe(100 * 10000);

      // Submit PO
      const submitRes = await t
        .http()
        .post(`/api/v1/purchase-orders/${poId}/submit`)
        .set(t.auth(managerToken))
        .expect(201);

      expect(submitRes.body.status).toBe('SUBMITTED');
    });

    it('receives stock with batch lot # and expiry, updating inventory & payables', async () => {
      const batchLot = 'LOT-AMX-001';
      const expiry = futureDate(365);

      const receiveRes = await t
        .http()
        .post(`/api/v1/purchase-orders/${poId}/receive`)
        .set(t.auth(pharmacistToken))
        .send({
          lines: [
            {
              productId,
              batchNumber: batchLot,
              expiryDate: expiry,
              quantityUnits: 100,
              unitCostMinor: 10000,
            },
          ],
          supplierInvoiceNumber: 'INV-SHAHEEN-101',
        })
        .expect(201);

      expect(receiveRes.body.purchaseOrder.status).toBe('RECEIVED');
      expect(receiveRes.body.receipt.status).toBe('ACCEPTED');

      // Verify product stock increased
      const prodCheck = await t
        .http()
        .get(`/api/v1/products/${productId}`)
        .set(t.auth(managerToken))
        .expect(200);

      expect(prodCheck.body.eligibleUnits).toBe(100);
      expect(prodCheck.body.onHandUnits).toBe(100);

      // Verify batch created
      const batchCheck = await t
        .http()
        .get(`/api/v1/inventory/batches?productId=${productId}`)
        .set(t.auth(pharmacistToken))
        .expect(200);

      expect(batchCheck.body.items.length).toBe(1);
      expect(batchCheck.body.items[0].batchNumber).toBe(batchLot);
      expect(batchCheck.body.items[0].onHandUnits).toBe(100);
      expect(batchCheck.body.items[0].status).toBe('ACTIVE');

      // Verify stock movement was recorded
      const movements = await t
        .http()
        .get(`/api/v1/inventory/movements?productId=${productId}`)
        .set(t.auth(managerToken))
        .expect(200);

      expect(movements.body.items.some((m: any) => m.type === 'RECEIPT' && m.quantityUnits === 100)).toBe(true);

      // Verify supplier payable ledger updated
      const payables = await t
        .http()
        .get('/api/v1/finance/payables')
        .set(t.auth(ownerToken))
        .expect(200);

      const sup = payables.body.bySupplier.find((s: any) => s.supplierId === supplierId);
      expect(sup).toBeDefined();
      expect(sup.outstandingMinor).toBe(100 * 10000);
    });
  });

  // ==========================================
  // Workflow B — POS Sale
  // ==========================================
  describe('Workflow B: POS Sale Execution & Thermal Receipt', () => {
    let sessionId: string;
    let productId: string;
    let saleId: string;

    beforeAll(async () => {
      // Create product with stock
      const prod = await t.http().post('/api/v1/products').set(t.auth(ownerToken)).send({
        sku: 'PAN-CF',
        barcode: '8964000112233',
        brandName: 'Panadol Cold & Flu',
        genericName: 'Paracetamol + Phenylephrine',
        dosageForm: 'Tablet',
        category: 'Analgesic',
        baseUnit: 'Tablet',
        sellingPriceMinor: 800, // PKR 8.00 per tablet
        reorderLevel: 20,
        reorderQuantity: 50,
        leadTimeDays: 2,
      });
      productId = prod.body.id;

      // Receive batch
      const supp = await t.http().post('/api/v1/suppliers').set(t.auth(ownerToken)).send({
        name: 'GSK Distro',
        phone: '0300-1112233',
      });
      await t.http().post('/api/v1/goods-receipts').set(t.auth(managerToken)).send({
        supplierId: supp.body.id,
        lines: [
          {
            productId,
            batchNumber: 'LOT-CF-1',
            expiryDate: futureDate(180),
            quantityUnits: 50,
            unitCostMinor: 500,
          },
        ],
      });
    });

    it('requires an active cash session to checkout', async () => {
      const res = await t
        .http()
        .post('/api/v1/pos/sales')
        .set(t.auth(cashierToken))
        .send({
          idempotencyKey: randomUUID(),
          lines: [{ productId, quantity: 2 }],
          tenders: [{ method: 'CASH', amountMinor: 1600 }],
        });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('NO_OPEN_CASH_SESSION');
    });

    it('opens a cashier drawer session', async () => {
      const openRes = await t
        .http()
        .post('/api/v1/cash-sessions/open')
        .set(t.auth(cashierToken))
        .send({ openingFloatMinor: 500_000 }) // Rs. 5,000 float
        .expect(201);

      sessionId = openRes.body.id;
      expect(openRes.body.status).toBe('OPEN');
      expect(openRes.body.openingFloatMinor).toBe(500_000);
      expect(openRes.body.expectedClosingMinor).toBe(500_000);
    });

    it('searches by barcode and gets live server quote', async () => {
      // Lookup by barcode
      const lookup = await t
        .http()
        .get('/api/v1/products/lookup?barcode=8964000112233')
        .set(t.auth(cashierToken))
        .expect(200);

      expect(lookup.body.product.id).toBe(productId);

      // Quote for 5 tablets
      const quote = await t
        .http()
        .post('/api/v1/pos/sales/quote')
        .set(t.auth(cashierToken))
        .send({
          lines: [{ productId, quantity: 5 }],
        })
        .expect(200);

      expect(quote.body.subtotalMinor).toBe(5 * 800);
      expect(quote.body.totalMinor).toBe(4000); // Rs. 40.00
      expect(quote.body.availability[productId].sufficient).toBe(true);
      expect(quote.body.availability[productId].eligibleUnits).toBe(50);
    });

    it('completes transactional cash checkout and prints server receipt', async () => {
      const checkoutRes = await t
        .http()
        .post('/api/v1/pos/sales')
        .set(t.auth(cashierToken))
        .send({
          idempotencyKey: randomUUID(),
          lines: [{ productId, quantity: 5 }],
          tenders: [{ method: 'CASH', amountMinor: 5000 }], // Tendered Rs. 50, change Rs. 10
        })
        .expect(201);

      saleId = checkoutRes.body.id;
      expect(checkoutRes.body.invoiceNumber).toMatch(/^INV-/);
      expect(checkoutRes.body.totalMinor).toBe(4000);
      expect(checkoutRes.body.paidMinor).toBe(4000);
      expect(checkoutRes.body.changeMinor).toBe(1000);
      expect(checkoutRes.body.lines[0].allocations.length).toBeGreaterThan(0);

      // Verify stock decreased from 50 to 45
      const prodAfter = await t
        .http()
        .get(`/api/v1/products/${productId}`)
        .set(t.auth(cashierToken))
        .expect(200);

      expect(prodAfter.body.eligibleUnits).toBe(45);

      // Verify receipt endpoint generates accurate pharmacy details
      const receipt = await t
        .http()
        .get(`/api/v1/sales/${saleId}/receipt`)
        .set(t.auth(cashierToken))
        .expect(200);

      expect(receipt.body.sale.invoiceNumber).toBe(checkoutRes.body.invoiceNumber);
      expect(receipt.body.pharmacy).toBeDefined();

      // Verify cash session expected closing increased by cash sale (4000)
      const sessionAfter = await t
        .http()
        .get(`/api/v1/cash-sessions/${sessionId}`)
        .set(t.auth(cashierToken))
        .expect(200);

      expect(sessionAfter.body.cashSalesMinor).toBe(4000);
      expect(sessionAfter.body.expectedClosingMinor).toBe(500_000 + 4000);
    });
  });

  // ==========================================
  // Workflow C — Concurrency & Duplicate Protection
  // ==========================================
  describe('Workflow C: Concurrency, Idempotency & Over-selling Prevention', () => {
    let productId: string;
    let suppId: string;

    beforeAll(async () => {
      const prod = await t.http().post('/api/v1/products').set(t.auth(ownerToken)).send({
        sku: 'RARE-MED',
        brandName: 'Rare Antibiotic',
        genericName: 'Meropenem',
        dosageForm: 'Injection',
        category: 'Antibiotic',
        baseUnit: 'Vial',
        sellingPriceMinor: 250000,
        reorderLevel: 5,
        reorderQuantity: 10,
        leadTimeDays: 1,
      });
      productId = prod.body.id;

      const supp = await t.http().post('/api/v1/suppliers').set(t.auth(ownerToken)).send({ name: 'MedSupply', phone: '0300-3334444' });
      suppId = supp.body.id;

      // Exactly 3 vials in stock
      await t.http().post('/api/v1/goods-receipts').set(t.auth(managerToken)).send({
        supplierId: suppId,
        lines: [
          {
            productId,
            batchNumber: 'LOT-RARE',
            expiryDate: futureDate(90),
            quantityUnits: 3,
            unitCostMinor: 150000,
          },
        ],
      });
    });

    it('returns identical result when same idempotency key is submitted twice (no double charge or stock decrement)', async () => {
      const key = randomUUID();
      const payload = {
        idempotencyKey: key,
        lines: [{ productId, quantity: 1 }],
        tenders: [{ method: 'CASH', amountMinor: 250000 }],
      };

      const first = await t.http().post('/api/v1/pos/sales').set(t.auth(cashierToken)).send(payload).expect(201);
      const second = await t.http().post('/api/v1/pos/sales').set(t.auth(cashierToken)).send(payload).expect(201);

      expect(first.body.id).toBe(second.body.id);
      expect(first.body.invoiceNumber).toBe(second.body.invoiceNumber);

      // Stock should only be decremented ONCE: 3 - 1 = 2
      const prod = await t.http().get(`/api/v1/products/${productId}`).set(t.auth(ownerToken));
      expect(prod.body.eligibleUnits).toBe(2);
    });

    it('rejects checkout when requested quantity exceeds available stock (no overselling)', async () => {
      const res = await t
        .http()
        .post('/api/v1/pos/sales')
        .set(t.auth(cashierToken))
        .send({
          idempotencyKey: randomUUID(),
          lines: [{ productId, quantity: 5 }], // 5 requested, only 2 left
          tenders: [{ method: 'CASH', amountMinor: 5 * 250000 }],
        });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INSUFFICIENT_STOCK');

      // Stock must remain intact at 2
      const prod = await t.http().get(`/api/v1/products/${productId}`).set(t.auth(ownerToken));
      expect(prod.body.eligibleUnits).toBe(2);
    });

    it('handles concurrency: 2 units left, two concurrent checkouts for 2 units each -> exactly 1 succeeds', async () => {
      const req1 = t
        .http()
        .post('/api/v1/pos/sales')
        .set(t.auth(cashierToken))
        .send({
          idempotencyKey: randomUUID(),
          lines: [{ productId, quantity: 2 }],
          tenders: [{ method: 'CASH', amountMinor: 2 * 250000 }],
        });

      const req2 = t
        .http()
        .post('/api/v1/pos/sales')
        .set(t.auth(cashierToken))
        .send({
          idempotencyKey: randomUUID(),
          lines: [{ productId, quantity: 2 }],
          tenders: [{ method: 'CASH', amountMinor: 2 * 250000 }],
        });

      const [res1, res2] = await Promise.all([req1, req2]);
      const statuses = [res1.status, res2.status].sort();

      expect(statuses).toEqual([201, 422]);

      // Stock must be exactly 0 now
      const prod = await t.http().get(`/api/v1/products/${productId}`).set(t.auth(ownerToken));
      expect(prod.body.eligibleUnits).toBe(0);
    });
  });

  // ==========================================
  // Workflow D — Returns and Refunds
  // ==========================================
  describe('Workflow D: Customer Returns, Dispositions & Approvals', () => {
    let productId: string;
    let saleId: string;
    let returnId: string;
    let originalBatchId: string;

    beforeAll(async () => {
      const prod = await t.http().post('/api/v1/products').set(t.auth(ownerToken)).send({
        sku: 'RET-ITEM',
        brandName: 'Returnable Syrup',
        genericName: 'Cough Syrup',
        dosageForm: 'Syrup',
        category: 'Analgesic',
        baseUnit: 'Bottle',
        sellingPriceMinor: 20000, // Rs. 200
        reorderLevel: 5,
        reorderQuantity: 10,
        leadTimeDays: 2,
      });
      productId = prod.body.id;

      const supp = await t.http().post('/api/v1/suppliers').set(t.auth(ownerToken)).send({ name: 'RetSup', phone: '0300-9998888' });
      const grn = await t.http().post('/api/v1/goods-receipts').set(t.auth(managerToken)).send({
        supplierId: supp.body.id,
        lines: [{ productId, batchNumber: 'LOT-RET', expiryDate: futureDate(120), quantityUnits: 20, unitCostMinor: 12000 }],
      });

      const batches = await t.http().get(`/api/v1/inventory/batches?productId=${productId}`).set(t.auth(ownerToken));
      originalBatchId = batches.body.items[0].id;

      // Sell 5 units
      const sale = await t.http().post('/api/v1/pos/sales').set(t.auth(cashierToken)).send({
        idempotencyKey: randomUUID(),
        lines: [{ productId, quantity: 5 }],
        tenders: [{ method: 'CASH', amountMinor: 100000 }],
      });
      saleId = sale.body.id;

      // Pharmacist opens cash session to disburse cash refunds
      await t
        .http()
        .post('/api/v1/cash-sessions/open')
        .set(t.auth(pharmacistToken))
        .send({ openingFloatMinor: 100_000 });
    });

    it('cashier creates a return request with RESTOCK disposition', async () => {
      const res = await t
        .http()
        .post(`/api/v1/sales/${saleId}/returns`)
        .set(t.auth(cashierToken))
        .send({
          lines: [{ lineIndex: 0, quantityUnits: 2, disposition: 'RESTOCK' }],
          reason: 'Customer returned unopened bottles',
          refundMethod: 'CASH',
        })
        .expect(201);

      returnId = res.body.id;
      expect(res.body.status).toBe('PENDING_APPROVAL');
      expect(res.body.refundMinor).toBe(2 * 20000); // Rs. 400
    });

    it('prevents non-pharmacist / cashier from approving returns (RBAC check)', async () => {
      const res = await t
        .http()
        .post(`/api/v1/sales/${saleId}/returns/${returnId}/approve`)
        .set(t.auth(cashierToken));

      expect(res.status).toBe(403);
    });

    it('pharmacist approves return and RESTOCK restores stock units into batch', async () => {
      const beforeBatch = await t.http().get(`/api/v1/inventory/batches/${originalBatchId}`).set(t.auth(ownerToken));
      expect(beforeBatch.body.onHandUnits).toBe(15); // 20 - 5 = 15

      const approveRes = await t
        .http()
        .post(`/api/v1/sales/${saleId}/returns/${returnId}/approve`)
        .set(t.auth(pharmacistToken))
        .expect(201);

      expect(approveRes.body.status).toBe('APPROVED');

      // Batch on-hand must increase from 15 to 17
      const afterBatch = await t.http().get(`/api/v1/inventory/batches/${originalBatchId}`).set(t.auth(ownerToken));
      expect(afterBatch.body.onHandUnits).toBe(17);

      // Verify SALE_RETURN movement was logged
      const movements = await t.http().get(`/api/v1/inventory/movements?productId=${productId}`).set(t.auth(ownerToken));
      expect(movements.body.items.some((m: any) => m.type === 'SALE_RETURN' && m.quantityUnits === 2)).toBe(true);
    });

    it('prevents returning more units than originally purchased', async () => {
      // 5 originally purchased, 2 already returned -> only 3 can be returned
      const invalid = await t
        .http()
        .post(`/api/v1/sales/${saleId}/returns`)
        .set(t.auth(cashierToken))
        .send({
          lines: [{ lineIndex: 0, quantityUnits: 10, disposition: 'RESTOCK' }],
          refundMethod: 'CASH',
          reason: 'Excess return attempt',
        });

      expect(invalid.status).toBe(422);
    });
  });

  // ==========================================
  // Workflow E — Expiry and FEFO
  // ==========================================
  describe('Workflow E: FEFO Allocation & Expiry Gatekeeping', () => {
    let productId: string;
    let lotSoonId: string;
    let lotLaterId: string;

    beforeAll(async () => {
      const prod = await t.http().post('/api/v1/products').set(t.auth(ownerToken)).send({
        sku: 'FEFO-TEST',
        brandName: 'FEFO Test Caps',
        genericName: 'Cephalexin',
        dosageForm: 'Capsule',
        category: 'Antibiotic',
        baseUnit: 'Capsule',
        sellingPriceMinor: 500,
        reorderLevel: 5,
        reorderQuantity: 20,
        leadTimeDays: 2,
      });
      productId = prod.body.id;

      const supp = await t.http().post('/api/v1/suppliers').set(t.auth(ownerToken)).send({ name: 'FefoDist', phone: '0300-5556666' });

      // Receive 2 active batches with different expiry dates:
      // Batch A: expires in 30 days (10 units)
      // Batch B: expires in 120 days (20 units)
      await t.http().post('/api/v1/goods-receipts').set(t.auth(managerToken)).send({
        supplierId: supp.body.id,
        lines: [
          { productId, batchNumber: 'LOT-SOON', expiryDate: futureDate(30), quantityUnits: 10, unitCostMinor: 300 },
          { productId, batchNumber: 'LOT-LATER', expiryDate: futureDate(120), quantityUnits: 20, unitCostMinor: 300 },
        ],
      });

      const batches = await t.http().get(`/api/v1/inventory/batches?productId=${productId}`).set(t.auth(ownerToken));
      lotSoonId = batches.body.items.find((b: any) => b.batchNumber === 'LOT-SOON').id;
      lotLaterId = batches.body.items.find((b: any) => b.batchNumber === 'LOT-LATER').id;
    });

    it('allocates strictly from sooner-expiring batch first (FEFO)', async () => {
      // Selling 5 units should deplete 5 from LOT-SOON (30 days) and 0 from LOT-LATER (120 days)
      const quote = await t
        .http()
        .post('/api/v1/pos/sales/quote')
        .set(t.auth(cashierToken))
        .send({ lines: [{ productId, quantity: 5 }] })
        .expect(200);

      expect(quote.body.availability[productId].sufficient).toBe(true);

      const checkoutRes = await t.http().post('/api/v1/pos/sales').set(t.auth(cashierToken)).send({
        idempotencyKey: randomUUID(),
        lines: [{ productId, quantity: 5 }],
        tenders: [{ method: 'CASH', amountMinor: 2500 }],
      }).expect(201);

      expect(checkoutRes.body.lines[0].allocations.length).toBe(1);
      expect(checkoutRes.body.lines[0].allocations[0].batchNumber).toBe('LOT-SOON');
      expect(checkoutRes.body.lines[0].allocations[0].quantityUnits).toBe(5);

      const bSoon = await t.http().get(`/api/v1/inventory/batches/${lotSoonId}`).set(t.auth(ownerToken));
      expect(bSoon.body.onHandUnits).toBe(5); // 10 - 5 = 5 left

      const bLater = await t.http().get(`/api/v1/inventory/batches/${lotLaterId}`).set(t.auth(ownerToken));
      expect(bLater.body.onHandUnits).toBe(20); // completely untouched
    });

    it('splits allocation across batches when sooner batch has insufficient units', async () => {
      // 5 units left in LOT-SOON. Customer requests 8 units.
      // Expected FEFO: 5 from LOT-SOON + 3 from LOT-LATER
      const quote = await t
        .http()
        .post('/api/v1/pos/sales/quote')
        .set(t.auth(cashierToken))
        .send({ lines: [{ productId, quantity: 8 }] })
        .expect(200);

      expect(quote.body.availability[productId].sufficient).toBe(true);

      const checkoutRes = await t.http().post('/api/v1/pos/sales').set(t.auth(cashierToken)).send({
        idempotencyKey: randomUUID(),
        lines: [{ productId, quantity: 8 }],
        tenders: [{ method: 'CASH', amountMinor: 4000 }],
      }).expect(201);

      expect(checkoutRes.body.lines[0].allocations.length).toBe(2);
      expect(checkoutRes.body.lines[0].allocations[0].batchNumber).toBe('LOT-SOON');
      expect(checkoutRes.body.lines[0].allocations[0].quantityUnits).toBe(5);
      expect(checkoutRes.body.lines[0].allocations[1].batchNumber).toBe('LOT-LATER');
      expect(checkoutRes.body.lines[0].allocations[1].quantityUnits).toBe(3);

      const bSoon = await t.http().get(`/api/v1/inventory/batches/${lotSoonId}`).set(t.auth(ownerToken));
      expect(bSoon.body.onHandUnits).toBe(0); // depleted
      expect(bSoon.body.status).toBe('DEPLETED');

      const bLater = await t.http().get(`/api/v1/inventory/batches/${lotLaterId}`).set(t.auth(ownerToken));
      expect(bLater.body.onHandUnits).toBe(17); // 20 - 3 = 17 left
    });

    it('never sells from quarantined or expired batches', async () => {
      // Quarantine LOT-LATER
      await t
        .http()
        .patch(`/api/v1/inventory/batches/${lotLaterId}/status`)
        .set(t.auth(pharmacistToken))
        .send({ status: 'QUARANTINED', reason: 'Packaging integrity check' })
        .expect(200);

      // Now LOT-SOON is depleted (0) and LOT-LATER is quarantined (17 units exist physically, but 0 eligible)
      const prod = await t.http().get(`/api/v1/products/${productId}`).set(t.auth(ownerToken));
      expect(prod.body.onHandUnits).toBe(17);
      expect(prod.body.eligibleUnits).toBe(0);

      // Sale attempt must fail with INSUFFICIENT_STOCK
      const res = await t
        .http()
        .post('/api/v1/pos/sales')
        .set(t.auth(cashierToken))
        .send({
          idempotencyKey: randomUUID(),
          lines: [{ productId, quantity: 1 }],
          tenders: [{ method: 'CASH', amountMinor: 500 }],
        });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INSUFFICIENT_STOCK');
    });
  });

  // ==========================================
  // Workflow F — Cash Drawer & Reconciliation
  // ==========================================
  describe('Workflow F: Cash Drawer Lifecycle & Shift Reconciliation', () => {
    let cToken: string;
    let sId: string;

    beforeAll(async () => {
      await t.createUser('drawer_cashier', 'CASHIER');
      cToken = await t.login('drawer_cashier');
    });

    it('runs full cash session lifecycle: open -> cash in -> cash out -> sales -> close with variance -> reconcile', async () => {
      // 1. Open with 10,000 float
      const open = await t
        .http()
        .post('/api/v1/cash-sessions/open')
        .set(t.auth(cToken))
        .send({ openingFloatMinor: 1_000_000 }) // Rs. 10,000
        .expect(201);

      sId = open.body.id;

      // 2. Cash In Rs. 1,000 (adding small change bills)
      await t
        .http()
        .post(`/api/v1/cash-sessions/${sId}/cash-movements`)
        .set(t.auth(cToken))
        .send({ type: 'CASH_IN', amountMinor: 100_000, reason: 'Extra Rs. 10 and 20 notes from manager' })
        .expect(201);

      // 3. Cash Out Rs. 300 (petty cash for tape/stationery)
      await t
        .http()
        .post(`/api/v1/cash-sessions/${sId}/cash-movements`)
        .set(t.auth(cToken))
        .send({ type: 'CASH_OUT', amountMinor: 30_000, reason: 'Packaging tape purchase' })
        .expect(201);

      // Expected so far: 10,000 + 1,000 - 300 = Rs. 10,700 (1,070,000 paisa)
      const sessMid = await t.http().get(`/api/v1/cash-sessions/${sId}`).set(t.auth(cToken));
      expect(sessMid.body.expectedClosingMinor).toBe(1_070_000);

      // 4. Close shift: Counted Rs. 10,650 (Rs. 50 shortage variance)
      const close = await t
        .http()
        .post(`/api/v1/cash-sessions/${sId}/close`)
        .set(t.auth(cToken))
        .send({ countedClosingMinor: 1_065_000, notes: 'End of evening shift, Rs. 50 discrepancy' })
        .expect(201);

      expect(close.body.status).toBe('CLOSED');
      expect(close.body.countedClosingMinor).toBe(1_065_000);
      expect(close.body.varianceMinor).toBe(-5000); // -Rs. 50.00

      // 5. Manager reconciles the session
      const rec = await t
        .http()
        .post(`/api/v1/cash-sessions/${sId}/reconcile`)
        .set(t.auth(managerToken))
        .send({ notes: 'Verified and approved with minor variance' })
        .expect(201);

      expect(rec.body.status).toBe('RECONCILED');
    });
  });

  // ==========================================
  // Workflow G — Permissions Enforcement
  // ==========================================
  describe('Workflow G: Role-Based Access Control (RBAC) Hard Enforcement', () => {
    it('strictly forbids Cashier from catalog creation, system settings, or stock adjustments', async () => {
      // Cashier cannot create product
      const pRes = await t.http().post('/api/v1/products').set(t.auth(cashierToken)).send({
        sku: 'HACK-1',
        brandName: 'Hack',
        category: 'Analgesic',
        baseUnit: 'Unit',
        sellingPriceMinor: 100,
      });
      expect(pRes.status).toBe(403);

      // Cashier cannot adjust inventory
      const adjRes = await t.http().post('/api/v1/inventory/adjustments').set(t.auth(cashierToken)).send({
        batchId: '600000000000000000000001',
        quantityUnits: 5,
        type: 'WRITE_OFF',
        reason: 'Attempted hack',
      });
      expect(adjRes.status).toBe(403);
    });

    it('strictly forbids Stock Manager from POS sales or financial accounts access', async () => {
      const posRes = await t.http().post('/api/v1/pos/sales').set(t.auth(stockManagerToken)).send({
        idempotencyKey: randomUUID(),
        lines: [],
        tenders: [],
      });
      expect(posRes.status).toBe(403);

      const finRes = await t.http().get('/api/v1/finance/receivables').set(t.auth(stockManagerToken));
      expect(finRes.status).toBe(403);
    });

    it('strictly forbids non-Owner from user administration', async () => {
      const userRes = await t.http().post('/api/v1/users').set(t.auth(managerToken)).send({
        username: 'new_staff',
        name: 'New Staff',
        password: 'Password123!',
        role: 'CASHIER',
      });
      expect(userRes.status).toBe(403);
    });
  });

  // ==========================================
  // Workflow H — Financial Consistency & Precision
  // ==========================================
  describe('Workflow H: Financial Reconciliation & Integer Arithmetic Consistency', () => {
    it('verifies gross profit, revenue aggregates, and integer paisa precision', async () => {
      const gp = await t.http().get('/api/v1/reports/gross-profit').set(t.auth(ownerToken)).expect(200);

      expect(gp.body.grossSalesMinor).toBeGreaterThan(0);
      expect(gp.body.cogsMinor).toBeGreaterThan(0);
      expect(gp.body.grossProfitMinor).toBe(gp.body.netSalesMinor - gp.body.cogsMinor);

      // Verified exact integer arithmetic without IEEE-754 floating point distortion
      expect(Number.isInteger(gp.body.grossSalesMinor)).toBe(true);
      expect(Number.isInteger(gp.body.cogsMinor)).toBe(true);
      expect(Number.isInteger(gp.body.grossProfitMinor)).toBe(true);
    });
  });
});
