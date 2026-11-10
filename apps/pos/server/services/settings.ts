import { randomUUID } from 'node:crypto';
import type { Discount, PosSettings, StoreSettings, Tax } from '../../shared/types';
import type { Db } from '../db/database';
import { currentBranch } from './context';
import { fail, int, nowIso, obj, oneOf, optText, optUuid, text, uuid } from './validate';

// ---------------------------------------------------------------- store info

export function getStoreSettings(db: Db): StoreSettings {
  const b = currentBranch(db);
  const s = db
    .prepare(`SELECT name, address, phone, receipt_header, receipt_footer, currency FROM stores WHERE id = ?`)
    .get(b.storeId) as {
    name: string;
    address: string | null;
    phone: string | null;
    receipt_header: string | null;
    receipt_footer: string | null;
    currency: string;
  };
  return {
    storeName: s.name,
    address: s.address,
    phone: s.phone,
    receiptHeader: s.receipt_header,
    receiptFooter: s.receipt_footer,
    currency: s.currency,
    branchName: b.name,
    branchCode: b.code,
  };
}

export function saveStoreSettings(db: Db, input: Partial<StoreSettings>): StoreSettings {
  const i = obj(input, 'Store settings');
  const b = currentBranch(db);
  const currency = text(i.currency ?? 'PHP', 'Currency', { max: 3 }).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) fail('Currency must be a 3-letter code, e.g. PHP');
  const branchName = text(i.branchName ?? b.name, 'Branch name', { max: 60 });
  db.transaction(() => {
    db.prepare(
      `UPDATE stores SET name = ?, address = ?, phone = ?, receipt_header = ?, receipt_footer = ?, currency = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      text(i.storeName, 'Store name', { max: 100 }),
      optText(i.address, 'Address', 255),
      optText(i.phone, 'Phone', 40),
      optText(i.receiptHeader, 'Receipt header', 300),
      optText(i.receiptFooter, 'Receipt footer', 300),
      currency,
      nowIso(),
      b.storeId,
    );
    db.prepare(`UPDATE branches SET name = ?, updated_at = ? WHERE id = ?`).run(branchName, nowIso(), b.id);
  })();
  return getStoreSettings(db);
}

// ---------------------------------------------------------------- POS preferences (settings key/value)

const DEFAULT_POS: PosSettings = { receiptWidth: 80, autoPrint: false, lowStockDefault: 5 };

export function getPosSettings(db: Db): PosSettings {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'pos'`).get() as { value: string } | undefined;
  if (!row) return DEFAULT_POS;
  try {
    return { ...DEFAULT_POS, ...(JSON.parse(row.value) as Partial<PosSettings>) };
  } catch {
    return DEFAULT_POS;
  }
}

export function savePosSettings(db: Db, input: Partial<PosSettings>): PosSettings {
  const i = obj(input, 'POS settings');
  const next: PosSettings = {
    receiptWidth: i.receiptWidth === 58 ? 58 : 80,
    autoPrint: i.autoPrint === true,
    lowStockDefault: int(i.lowStockDefault ?? DEFAULT_POS.lowStockDefault, 'Default low-stock alert', { min: 0, max: 100_000 }),
  };
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('pos', ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(JSON.stringify(next), nowIso());
  return next;
}

export function getSetting(db: Db, key: string): string | null {
  return (db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined)?.value ?? null;
}

// ---------------------------------------------------------------- taxes

export function listTaxes(db: Db): Tax[] {
  return (
    db
      .prepare(
        `SELECT id, name, rate_bps AS rateBps, is_inclusive AS isInclusive, is_default AS isDefault
         FROM taxes WHERE is_active = 1 ORDER BY name COLLATE NOCASE`,
      )
      .all() as { id: string; name: string; rateBps: number; isInclusive: number; isDefault: number }[]
  ).map((t) => ({ ...t, isInclusive: t.isInclusive === 1, isDefault: t.isDefault === 1 }));
}

export function saveTax(
  db: Db,
  input: { id?: string; name: string; rateBps: number; isInclusive: boolean; isDefault?: boolean },
): Tax {
  const i = obj(input, 'Tax');
  const id = optUuid(i.id, 'tax') ?? randomUUID();
  const name = text(i.name, 'Tax name', { max: 40 });
  const rate = int(i.rateBps, 'Tax rate', { min: 0, max: 10_000 });
  const isDefault = i.isDefault === true;
  db.transaction(() => {
    if (isDefault) db.prepare(`UPDATE taxes SET is_default = 0`).run();
    db.prepare(
      `INSERT INTO taxes (id, name, rate_bps, is_inclusive, is_default) VALUES (@id, @name, @rate, @inc, @def)
       ON CONFLICT (id) DO UPDATE SET name = @name, rate_bps = @rate, is_inclusive = @inc, is_default = @def, updated_at = @now`,
    ).run({ id, name, rate, inc: i.isInclusive === false ? 0 : 1, def: isDefault ? 1 : 0, now: nowIso() });
  })();
  return listTaxes(db).find((t) => t.id === id) ?? fail('Tax not found');
}

/** Deactivates the tax and detaches it from products. Past sales keep their stored tax amounts. */
export function deleteTax(db: Db, taxId: string): void {
  const id = uuid(taxId, 'tax');
  db.transaction(() => {
    db.prepare(`UPDATE products SET tax_id = NULL, updated_at = ? WHERE tax_id = ?`).run(nowIso(), id);
    db.prepare(`UPDATE taxes SET is_active = 0, is_default = 0, updated_at = ? WHERE id = ?`).run(nowIso(), id);
  })();
}

// ---------------------------------------------------------------- discount presets

export function listDiscounts(db: Db): Discount[] {
  return db
    .prepare(`SELECT id, name, type, value FROM discounts WHERE is_active = 1 ORDER BY name COLLATE NOCASE`)
    .all() as Discount[];
}

export function saveDiscount(db: Db, input: { id?: string; name: string; type: 'percent' | 'fixed'; value: number }): Discount {
  const i = obj(input, 'Discount');
  const id = optUuid(i.id, 'discount') ?? randomUUID();
  const type = oneOf(i.type, 'discount type', ['percent', 'fixed'] as const);
  const value = int(i.value, 'Discount value', { min: 1, max: type === 'percent' ? 10_000 : 100_000_000 });
  db.prepare(
    `INSERT INTO discounts (id, name, type, value) VALUES (@id, @name, @type, @value)
     ON CONFLICT (id) DO UPDATE SET name = @name, type = @type, value = @value, updated_at = @now`,
  ).run({ id, name: text(i.name, 'Discount name', { max: 40 }), type, value, now: nowIso() });
  return listDiscounts(db).find((d) => d.id === id) ?? fail('Discount not found');
}

export function deleteDiscount(db: Db, discountId: string): void {
  db.prepare(`UPDATE discounts SET is_active = 0, updated_at = ? WHERE id = ?`).run(nowIso(), uuid(discountId, 'discount'));
}
