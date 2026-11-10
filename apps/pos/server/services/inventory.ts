import { randomUUID } from 'node:crypto';
import type { StockAdjustment, StockMovement, StockReason } from '../../shared/types';
import type { Db } from '../db/database';
import { currentBranch } from './context';
import { fail, int, nowIso, num, obj, oneOf, optText, optUuid, uuid } from './validate';

/**
 * Changes stock by `delta` and writes the movement row. When part of a larger
 * operation (a sale, a void) the caller must already be inside a transaction.
 */
export function applyStockDelta(
  db: Db,
  p: {
    productId: string;
    branchId: string;
    delta: number;
    reason: StockReason;
    referenceType?: string | null;
    referenceId?: string | null;
    note?: string | null;
    at?: string;
  },
): number {
  const at = p.at ?? nowIso();
  const { quantity } = db
    .prepare(
      `INSERT INTO inventory (product_id, branch_id, quantity, updated_at) VALUES (?, ?, round(?, 3), ?)
       ON CONFLICT (product_id, branch_id)
       DO UPDATE SET quantity = round(quantity + excluded.quantity, 3), updated_at = excluded.updated_at
       RETURNING quantity`,
    )
    .get(p.productId, p.branchId, p.delta, at) as { quantity: number };
  db.prepare(
    `INSERT INTO inventory_movements
       (id, product_id, branch_id, quantity_delta, quantity_after, reason, reference_type, reference_id, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(), p.productId, p.branchId, p.delta, quantity, p.reason,
    p.referenceType ?? null, p.referenceId ?? null, p.note ?? null, at,
  );
  return quantity;
}

export function adjustStock(db: Db, input: StockAdjustment): { productId: string; stock: number } {
  const i = obj(input, 'Adjustment');
  const productId = uuid(i.productId, 'product');
  const mode = oneOf(i.mode, 'adjustment type', ['add', 'remove', 'set'] as const);
  const qty = num(i.quantity, 'Quantity', { min: 0, max: 1_000_000 });
  const note = optText(i.note, 'Note', 200);
  if (mode !== 'set' && qty === 0) fail('Quantity must be more than 0');

  const branch = currentBranch(db);
  return db.transaction(() => {
    const product = db
      .prepare(`SELECT track_stock FROM products WHERE id = ? AND deleted_at IS NULL`)
      .get(productId) as { track_stock: number } | undefined;
    if (!product) fail('Product not found');
    if (!product.track_stock) fail('Stock tracking is off for this product');
    const row = db
      .prepare(`SELECT quantity FROM inventory WHERE product_id = ? AND branch_id = ?`)
      .get(productId, branch.id) as { quantity: number } | undefined;
    const current = row?.quantity ?? 0;
    const delta = mode === 'add' ? qty : mode === 'remove' ? -qty : Math.round((qty - current) * 1000) / 1000;
    if (delta === 0) return { productId, stock: current };
    const reason: StockReason = mode === 'add' ? 'receive' : mode === 'set' ? 'count' : 'adjustment';
    return { productId, stock: applyStockDelta(db, { productId, branchId: branch.id, delta, reason, note }) };
  })();
}

export function listMovements(db: Db, query?: { productId?: string; limit?: number }): StockMovement[] {
  const productId = optUuid(query?.productId, 'product');
  const limit = query?.limit === undefined ? 100 : int(query.limit, 'limit', { min: 1, max: 500 });
  const params: unknown[] = [currentBranch(db).id];
  if (productId) params.push(productId);
  params.push(limit);
  return db
    .prepare(
      `SELECT m.id, m.product_id AS productId, p.name AS productName, m.quantity_delta AS delta,
              m.quantity_after AS after, m.reason, m.note, m.reference_id AS referenceId, m.created_at AS createdAt
       FROM inventory_movements m JOIN products p ON p.id = m.product_id
       WHERE m.branch_id = ? ${productId ? 'AND m.product_id = ?' : ''}
       ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?`,
    )
    .all(...params) as StockMovement[];
}

export function lowStockCount(db: Db): number {
  const { n } = db
    .prepare(
      `SELECT COUNT(*) AS n FROM products p
       LEFT JOIN inventory i ON i.product_id = p.id AND i.branch_id = ?
       WHERE p.deleted_at IS NULL AND p.is_active = 1 AND p.track_stock = 1
         AND p.low_stock_threshold IS NOT NULL AND COALESCE(i.quantity, 0) <= p.low_stock_threshold`,
    )
    .get(currentBranch(db).id) as { n: number };
  return n;
}
