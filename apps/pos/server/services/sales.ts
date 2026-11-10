import { randomUUID } from 'node:crypto';
import { calcCart, type PricingDiscount } from '../../shared/pricing';
import type {
  PaymentMethod,
  ReceiptContent,
  SaleDetail,
  SaleInput,
  SaleItem,
  SalesPage,
  SalesQuery,
  SaleSummary,
} from '../../shared/types';
import type { Db } from '../db/database';
import { clampHistory, currentBranch, dayBoundsUtc } from './context';
import { applyStockDelta } from './inventory';
import { renderReceiptHtml } from './receipt';
import { getPosSettings, getStoreSettings } from './settings';
import { resolveCashier } from './staff';
import { dateStr, fail, int, nowIso, num, obj, oneOf, optText, optUuid, uuid } from './validate';

const METHODS = ['cash', 'card', 'ewallet', 'other'] as const;

interface ProductForSale {
  id: string;
  name: string;
  sku: string | null;
  selling_price: number;
  purchase_price: number;
  track_stock: number;
  tax_name: string | null;
  rate_bps: number | null;
  is_inclusive: number | null;
}

function resolveDiscount(db: Db, raw: unknown): (PricingDiscount & { id: string | null }) | null {
  if (raw === undefined || raw === null) return null;
  const d = obj(raw, 'Discount');
  const discountId = optUuid(d.discountId, 'discount');
  if (discountId) {
    const preset = db
      .prepare(`SELECT id, type, value FROM discounts WHERE id = ? AND is_active = 1`)
      .get(discountId) as { id: string; type: 'percent' | 'fixed'; value: number } | undefined;
    if (!preset) fail('That discount is no longer available');
    return preset;
  }
  const type = oneOf(d.type, 'discount type', ['percent', 'fixed'] as const);
  const value = int(d.value, 'Discount', { min: 0, max: type === 'percent' ? 10_000 : 100_000_000 });
  return value === 0 ? null : { id: null, type, value };
}

/** Saves a completed sale: one transaction for sale, items, payment, stock and receipt. */
export function createSale(db: Db, input: SaleInput): SaleDetail {
  const i = obj(input, 'Sale');
  if (!Array.isArray(i.items) || i.items.length === 0) fail('The cart is empty');
  if (i.items.length > 500) fail('Too many items in one sale');

  // Merge repeated lines of the same product.
  const qtyByProduct = new Map<string, number>();
  for (const raw of i.items as unknown[]) {
    const it = obj(raw, 'Item');
    const pid = uuid(it.productId, 'product');
    const q = num(it.quantity, 'Quantity', { min: 0.001, max: 100_000 });
    qtyByProduct.set(pid, Math.round(((qtyByProduct.get(pid) ?? 0) + q) * 1000) / 1000);
  }
  const payment = obj(i.payment, 'Payment');
  const method: PaymentMethod = oneOf(payment.method ?? 'cash', 'payment method', METHODS);
  const note = optText(i.note, 'Note', 200);
  const cashierId = resolveCashier(db, i.cashierId);

  const branch = currentBranch(db);
  const store = getStoreSettings(db);

  const saleId = db.transaction(() => {
    const getProduct = db.prepare(
      `SELECT p.id, p.name, p.sku, p.selling_price, p.purchase_price, p.track_stock,
              t.name AS tax_name, t.rate_bps, t.is_inclusive
       FROM products p LEFT JOIN taxes t ON t.id = p.tax_id AND t.is_active = 1
       WHERE p.id = ? AND p.deleted_at IS NULL AND p.is_active = 1`,
    );
    const lines = [...qtyByProduct].map(([pid, quantity]) => {
      const p = getProduct.get(pid) as ProductForSale | undefined;
      if (!p) fail('A product in the cart is no longer available. Remove it and try again.');
      return { p, quantity };
    });

    const discount = resolveDiscount(db, i.discount);
    const totals = calcCart(
      lines.map(({ p, quantity }) => ({
        unitPrice: p.selling_price,
        quantity,
        taxRateBps: p.rate_bps ?? 0,
        taxInclusive: p.is_inclusive !== 0,
      })),
      discount,
    );

    let tendered: number | null = totals.total;
    let change = 0;
    if (method === 'cash') {
      tendered = int(payment.tendered, 'Cash received', { min: 0, max: 1_000_000_000 });
      if (tendered < totals.total) fail('Cash received is less than the total');
      change = tendered - totals.total;
    }

    const { value: seq } = db
      .prepare(
        `INSERT INTO settings (key, value) VALUES ('receipt_seq', '1')
         ON CONFLICT (key) DO UPDATE SET value = CAST(value AS INTEGER) + 1, updated_at = ?
         RETURNING value`,
      )
      .get(nowIso()) as { value: string | number };
    const receiptNumber = `${branch.code}-${String(seq).padStart(6, '0')}`;
    const id = randomUUID();
    const at = nowIso();

    db.prepare(
      `INSERT INTO sales (id, receipt_number, branch_id, user_id, discount_id, status, subtotal, discount_total, tax_total,
         total, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, receiptNumber, branch.id, cashierId, discount?.id ?? null, totals.subtotal, totals.discountTotal, totals.taxTotal, totals.total, note, at, at);

    const insertItem = db.prepare(
      `INSERT INTO sale_items (id, sale_id, product_id, name, sku, quantity, unit_price, unit_cost, discount_amount,
         tax_amount, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const taxes = new Map<string, { name: string; amount: number; inclusive: boolean }>();
    lines.forEach(({ p, quantity }, idx) => {
      const priced = totals.lines[idx];
      insertItem.run(randomUUID(), id, p.id, p.name, p.sku, quantity, p.selling_price, p.purchase_price, priced.discount, priced.tax, priced.total);
      if (p.track_stock) {
        applyStockDelta(db, { productId: p.id, branchId: branch.id, delta: -quantity, reason: 'sale', referenceType: 'sale', referenceId: id, at });
      }
      if (priced.tax > 0 && p.tax_name) {
        const key = `${p.tax_name}|${p.is_inclusive}`;
        const t = taxes.get(key) ?? { name: p.tax_name, amount: 0, inclusive: p.is_inclusive !== 0 };
        t.amount += priced.tax;
        taxes.set(key, t);
      }
    });

    db.prepare(
      `INSERT INTO payments (id, sale_id, method, amount, tendered, change_due, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), id, method, totals.total, tendered, change, at);

    const content: ReceiptContent = {
      storeName: store.storeName,
      address: store.address,
      phone: store.phone,
      header: store.receiptHeader,
      footer: store.receiptFooter,
      branchName: store.branchName,
      currency: store.currency,
      receiptNumber,
      cashier: cashierId ? (db.prepare(`SELECT display_name FROM users WHERE id = ?`).get(cashierId) as { display_name: string }).display_name : null,
      createdAt: at,
      items: lines.map(({ p, quantity }, idx) => ({ name: p.name, quantity, unitPrice: p.selling_price, lineTotal: totals.lines[idx].gross })),
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxes: [...taxes.values()],
      total: totals.total,
      payment: { method, tendered, change },
    };
    db.prepare(`INSERT INTO receipts (id, sale_id, receipt_number, content, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      randomUUID(), id, receiptNumber, JSON.stringify(content), at,
    );
    return id;
  })();

  return getSale(db, saleId);
}

interface SaleRow {
  id: string;
  receiptNumber: string;
  status: SaleSummary['status'];
  total: number;
  itemCount: number;
  paymentMethod: PaymentMethod;
  cashierName: string | null;
  createdAt: string;
}

const SUMMARY_SELECT = `
  SELECT s.id, s.receipt_number AS receiptNumber, s.status, s.total, s.created_at AS createdAt,
         (SELECT COALESCE(SUM(quantity), 0) FROM sale_items si WHERE si.sale_id = s.id) AS itemCount,
         (SELECT method FROM payments pm WHERE pm.sale_id = s.id LIMIT 1) AS paymentMethod,
         (SELECT display_name FROM users u WHERE u.id = s.user_id) AS cashierName
  FROM sales s`;

export function listSales(db: Db, query?: SalesQuery): SalesPage {
  const q = query ?? {};
  const where = ['s.branch_id = @branchId'];
  const params: Record<string, unknown> = { branchId: currentBranch(db).id };
  const from = q.from ? dateStr(q.from, 'start date') : '1970-01-01';
  const to = q.to ? dateStr(q.to, 'end date') : '9999-12-30';
  const bounds = dayBoundsUtc(from, to);
  const clamped = clampHistory(db, bounds.start);
  where.push('s.created_at >= @start AND s.created_at < @end');
  params.start = clamped.start;
  params.end = bounds.end;
  const search = optText(q.search, 'Search', 40);
  if (search) {
    where.push('s.receipt_number LIKE @search');
    params.search = `%${search.replace(/[\\%_]/g, '')}%`;
  }
  const limit = q.limit === undefined ? 50 : int(q.limit, 'limit', { min: 1, max: 500 });
  const offset = q.offset === undefined ? 0 : int(q.offset, 'offset', { min: 0 });
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM sales s ${whereSql}`).get(params) as { n: number };
  const sales = db
    .prepare(`${SUMMARY_SELECT} ${whereSql} ORDER BY s.created_at DESC, s.rowid DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset }) as SaleRow[];
  return { sales, total: n, limitedFrom: clamped.limitedFrom };
}

export function getSale(db: Db, saleId: string): SaleDetail {
  const id = uuid(saleId, 'sale');
  const s = db
    .prepare(`${SUMMARY_SELECT.replace('FROM sales s', ', s.subtotal, s.discount_total, s.tax_total, s.note FROM sales s')} WHERE s.id = ?`)
    .get(id) as (SaleRow & { subtotal: number; discount_total: number; tax_total: number; note: string | null }) | undefined;
  if (!s) fail('Sale not found');
  const items = db
    .prepare(
      `SELECT id, product_id AS productId, name, sku, quantity, unit_price AS unitPrice,
              discount_amount AS discountAmount, tax_amount AS taxAmount, line_total AS lineTotal
       FROM sale_items WHERE sale_id = ? ORDER BY rowid`,
    )
    .all(id) as SaleItem[];
  const p = db
    .prepare(`SELECT method, amount, tendered, change_due AS change FROM payments WHERE sale_id = ? LIMIT 1`)
    .get(id) as SaleDetail['payment'];
  return {
    id: s.id,
    receiptNumber: s.receiptNumber,
    status: s.status,
    total: s.total,
    itemCount: s.itemCount,
    paymentMethod: s.paymentMethod,
    cashierName: s.cashierName,
    createdAt: s.createdAt,
    subtotal: s.subtotal,
    discountTotal: s.discount_total,
    taxTotal: s.tax_total,
    note: s.note,
    items,
    payment: p,
  };
}

/** Voids a completed sale and puts the stock back. The sale stays in history, marked VOIDED. */
export function voidSale(db: Db, saleId: string, reason?: string): SaleDetail {
  const id = uuid(saleId, 'sale');
  const why = optText(reason, 'Reason', 200);
  const branch = currentBranch(db);
  db.transaction(() => {
    const sale = db.prepare(`SELECT status FROM sales WHERE id = ?`).get(id) as { status: string } | undefined;
    if (!sale) fail('Sale not found');
    if (sale.status !== 'completed') fail('Only completed sales can be voided');
    const items = db
      .prepare(
        `SELECT si.product_id, si.quantity FROM sale_items si
         JOIN products p ON p.id = si.product_id AND p.track_stock = 1
         WHERE si.sale_id = ?`,
      )
      .all(id) as { product_id: string; quantity: number }[];
    const at = nowIso();
    for (const it of items) {
      applyStockDelta(db, {
        productId: it.product_id, branchId: branch.id, delta: it.quantity, reason: 'void',
        referenceType: 'sale', referenceId: id, note: why, at,
      });
    }
    db.prepare(
      `UPDATE sales SET status = 'voided', note = COALESCE(?, note), updated_at = ? WHERE id = ?`,
    ).run(why ? `Voided: ${why}` : null, at, id);
  })();
  return getSale(db, id);
}

/** Receipt document for preview/printing. Counts prints so reprints can be audited later. */
export function getReceiptHtml(db: Db, saleId: string, opts?: { markPrinted?: boolean }): string {
  const id = uuid(saleId, 'sale');
  const row = db
    .prepare(`SELECT r.content, s.status FROM receipts r JOIN sales s ON s.id = r.sale_id WHERE r.sale_id = ?`)
    .get(id) as { content: string; status: string } | undefined;
  if (!row) fail('Receipt not found');
  if (opts?.markPrinted) {
    db.prepare(`UPDATE receipts SET print_count = print_count + 1, last_printed_at = ? WHERE sale_id = ?`).run(nowIso(), id);
  }
  return renderReceiptHtml(JSON.parse(row.content) as ReceiptContent, getPosSettings(db).receiptWidth, {
    voided: row.status === 'voided',
  });
}
