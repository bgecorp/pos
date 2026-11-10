import { randomUUID } from 'node:crypto';
import type { Category, Product, ProductInput, ProductQuery } from '../../shared/types';
import type { Db } from '../db/database';
import { currentBranch } from './context';
import { applyStockDelta } from './inventory';
import { fail, int, nowIso, num, obj, optText, optUuid, text, uuid } from './validate';

// ---------------------------------------------------------------- categories

export function listCategories(db: Db): Category[] {
  return db
    .prepare(
      `SELECT c.id, c.name, c.color,
              (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.deleted_at IS NULL) AS productCount
       FROM categories c WHERE c.deleted_at IS NULL ORDER BY c.sort_order, c.name COLLATE NOCASE`,
    )
    .all() as Category[];
}

export function saveCategory(db: Db, input: { id?: string; name: string; color?: string | null }): Category {
  const i = obj(input, 'Category');
  const id = optUuid(i.id, 'category');
  const name = text(i.name, 'Category name', { max: 60 });
  const color = optText(i.color, 'Color', 20);
  const dup = db
    .prepare(`SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL AND id IS NOT ?`)
    .get(name, id);
  if (dup) fail(`Category "${name}" already exists`);

  if (id) {
    const r = db
      .prepare(`UPDATE categories SET name = ?, color = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
      .run(name, color, nowIso(), id);
    if (r.changes === 0) fail('Category not found');
    return listCategories(db).find((c) => c.id === id)!;
  }
  const newId = randomUUID();
  db.prepare(`INSERT INTO categories (id, name, color) VALUES (?, ?, ?)`).run(newId, name, color);
  return listCategories(db).find((c) => c.id === newId)!;
}

export function deleteCategory(db: Db, categoryId: string): void {
  const id = uuid(categoryId, 'category');
  db.transaction(() => {
    db.prepare(`UPDATE products SET category_id = NULL, updated_at = ? WHERE category_id = ?`).run(nowIso(), id);
    db.prepare(`UPDATE categories SET deleted_at = ? WHERE id = ?`).run(nowIso(), id);
  })();
}

// ---------------------------------------------------------------- products

interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category_id: string | null;
  category_name: string | null;
  tax_id: string | null;
  rate_bps: number | null;
  is_inclusive: number | null;
  purchase_price: number;
  selling_price: number;
  track_stock: number;
  low_stock_threshold: number | null;
  is_active: number;
  stock: number;
}

const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.sku, p.barcode, p.category_id, c.name AS category_name, p.tax_id,
         t.rate_bps, t.is_inclusive, p.purchase_price, p.selling_price, p.track_stock,
         p.low_stock_threshold, p.is_active, COALESCE(i.quantity, 0) AS stock
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id AND c.deleted_at IS NULL
  LEFT JOIN taxes t ON t.id = p.tax_id AND t.is_active = 1
  LEFT JOIN inventory i ON i.product_id = p.id AND i.branch_id = @branchId
  WHERE p.deleted_at IS NULL`;

function toProduct(r: ProductRow): Product {
  const trackStock = r.track_stock === 1;
  return {
    id: r.id,
    name: r.name,
    sku: r.sku,
    barcode: r.barcode,
    categoryId: r.category_id,
    categoryName: r.category_name,
    taxId: r.rate_bps === null ? null : r.tax_id,
    taxRateBps: r.rate_bps ?? 0,
    taxInclusive: r.is_inclusive !== 0,
    purchasePrice: r.purchase_price,
    sellingPrice: r.selling_price,
    trackStock,
    lowStockThreshold: r.low_stock_threshold,
    isActive: r.is_active === 1,
    stock: r.stock,
    isLowStock: trackStock && r.low_stock_threshold !== null && r.stock <= r.low_stock_threshold,
  };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);

export function listProducts(db: Db, query?: ProductQuery): Product[] {
  const q = query ?? {};
  const where: string[] = [];
  const params: Record<string, unknown> = { branchId: currentBranch(db).id };
  if (!q.includeInactive) where.push('p.is_active = 1');
  const search = optText(q.search, 'Search', 100);
  if (search) {
    where.push(`(p.name LIKE @like ESCAPE '\\' OR p.sku LIKE @like ESCAPE '\\' OR p.barcode LIKE @like ESCAPE '\\')`);
    params.like = `%${escapeLike(search)}%`;
  }
  const categoryId = optUuid(q.categoryId, 'category');
  if (categoryId) {
    where.push('p.category_id = @categoryId');
    params.categoryId = categoryId;
  }
  if (q.lowStockOnly) {
    where.push('p.track_stock = 1 AND p.low_stock_threshold IS NOT NULL AND COALESCE(i.quantity, 0) <= p.low_stock_threshold');
  }
  params.limit = q.limit === undefined ? 500 : int(q.limit, 'limit', { min: 1, max: 2000 });
  const sql = `${PRODUCT_SELECT} ${where.map((w) => `AND ${w}`).join(' ')} ORDER BY p.name COLLATE NOCASE LIMIT @limit`;
  return (db.prepare(sql).all(params) as ProductRow[]).map(toProduct);
}

export function getProduct(db: Db, productId: string): Product {
  const row = db.prepare(`${PRODUCT_SELECT} AND p.id = @id`).get({ branchId: currentBranch(db).id, id: uuid(productId, 'product') });
  return row ? toProduct(row as ProductRow) : fail('Product not found');
}

/** Exact barcode or SKU match, for scanners and "type code + Enter". Returns null if none. */
export function findProductByCode(db: Db, code: string): Product | null {
  const c = text(code, 'Code', { max: 64 });
  const row = db
    .prepare(`${PRODUCT_SELECT} AND p.is_active = 1 AND (p.barcode = @c OR p.sku = @c COLLATE NOCASE) LIMIT 1`)
    .get({ branchId: currentBranch(db).id, c });
  return row ? toProduct(row as ProductRow) : null;
}

export function saveProduct(db: Db, input: ProductInput): Product {
  const i = obj(input, 'Product');
  const id = optUuid(i.id, 'product');
  const name = text(i.name, 'Product name', { max: 120 });
  const sku = optText(i.sku, 'SKU', 64);
  const barcode = optText(i.barcode, 'Barcode', 64);
  if (barcode && !/^[\w\-.]+$/.test(barcode)) fail('Barcode can only contain letters, numbers, dashes and dots');
  const categoryId = optUuid(i.categoryId, 'category');
  const taxId = optUuid(i.taxId, 'tax');
  const purchasePrice = int(i.purchasePrice, 'Purchase price', { min: 0, max: 100_000_000 });
  const sellingPrice = int(i.sellingPrice, 'Selling price', { min: 0, max: 100_000_000 });
  const trackStock = i.trackStock !== false;
  const lowStock =
    i.lowStockThreshold === undefined || i.lowStockThreshold === null
      ? null
      : num(i.lowStockThreshold, 'Low-stock alert', { min: 0, max: 1_000_000 });
  const isActive = i.isActive !== false;
  const initialStock = i.initialStock === undefined || i.initialStock === null ? 0 : num(i.initialStock, 'Initial stock', { min: 0, max: 1_000_000 });

  // Friendly uniqueness errors instead of raw SQLite constraint messages.
  for (const [col, val, label] of [['sku', sku, 'SKU'], ['barcode', barcode, 'Barcode']] as const) {
    if (!val) continue;
    const other = db
      .prepare(`SELECT name FROM products WHERE ${col} = ? AND deleted_at IS NULL AND id IS NOT ?`)
      .get(val, id) as { name: string } | undefined;
    if (other) fail(`${label} ${val} is already used by "${other.name}"`);
  }
  if (categoryId && !db.prepare(`SELECT 1 FROM categories WHERE id = ? AND deleted_at IS NULL`).get(categoryId)) {
    fail('Category not found');
  }
  if (taxId && !db.prepare(`SELECT 1 FROM taxes WHERE id = ? AND is_active = 1`).get(taxId)) fail('Tax not found');

  const fields = [name, sku, barcode, categoryId, taxId, purchasePrice, sellingPrice, trackStock ? 1 : 0, lowStock, isActive ? 1 : 0];
  const branch = currentBranch(db);
  const savedId = db.transaction(() => {
    if (id) {
      const r = db
        .prepare(
          `UPDATE products SET name = ?, sku = ?, barcode = ?, category_id = ?, tax_id = ?, purchase_price = ?,
             selling_price = ?, track_stock = ?, low_stock_threshold = ?, is_active = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(...fields, nowIso(), id);
      if (r.changes === 0) fail('Product not found');
      return id;
    }
    const newId = randomUUID();
    db.prepare(
      `INSERT INTO products (name, sku, barcode, category_id, tax_id, purchase_price, selling_price, track_stock,
         low_stock_threshold, is_active, id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(...fields, newId);
    db.prepare(`INSERT INTO inventory (product_id, branch_id, quantity) VALUES (?, ?, 0)`).run(newId, branch.id);
    if (trackStock && initialStock > 0) {
      applyStockDelta(db, { productId: newId, branchId: branch.id, delta: initialStock, reason: 'receive', note: 'Initial stock' });
    }
    return newId;
  })();
  return getProduct(db, savedId);
}

/**
 * Soft delete: past sales keep their item snapshots. SKU/barcode are cleared so they
 * can be reused by a new product.
 */
export function deleteProduct(db: Db, productId: string): void {
  const id = uuid(productId, 'product');
  const r = db
    .prepare(
      `UPDATE products SET deleted_at = ?, is_active = 0, sku = NULL, barcode = NULL, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(nowIso(), nowIso(), id);
  if (r.changes === 0) fail('Product not found');
}
