import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { FEATURES } from '@pos/feature-entitlements';
import type { StaffInput, StaffMember, StaffRole } from '../../shared/types';
import type { Db } from '../db/database';
import { currentBranch, requireFeature } from './context';
import { fail, nowIso, obj, oneOf, optUuid, text, uuid } from './validate';

/**
 * Staff (Professional: employee management). Stored in the local `users` table.
 * Cashiers identify themselves by tapping their name and entering a PIN; each sale
 * records who made it. PINs are hashed (scrypt). A 4-6 digit PIN identifies, it doesn't
 * protect: this is a shared shop terminal, not an online account.
 */

const ROLES = ['owner', 'manager', 'cashier'] as const;

function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(pin, salt, 32, { N: 4096, r: 8, p: 1 });
  return `scrypt$4096$${salt.toString('base64')}$${key.toString('base64')}`;
}

function checkPin(pin: string, stored: string | null): boolean {
  if (!stored) return false;
  const [algo, n, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = scryptSync(pin, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: 8, p: 1 });
  return timingSafeEqual(key, expected);
}

const validPin = (v: unknown) => {
  if (typeof v !== 'string' || !/^\d{4,6}$/.test(v)) fail('PIN must be 4 to 6 digits');
  return v;
};

interface Row {
  id: string;
  display_name: string;
  role: StaffRole;
  is_active: number;
}
const toStaff = (r: Row): StaffMember => ({ id: r.id, name: r.display_name, role: r.role, isActive: r.is_active === 1 });

/** Active staff for the cashier picker, plus inactive ones when managing. */
export function listStaff(db: Db, opts?: { includeInactive?: boolean }): StaffMember[] {
  return (
    db
      .prepare(
        `SELECT id, display_name, role, is_active FROM users ${opts?.includeInactive ? '' : 'WHERE is_active = 1'}
         ORDER BY is_active DESC, CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, display_name COLLATE NOCASE`,
      )
      .all() as Row[]
  ).map(toStaff);
}

export function saveStaff(db: Db, input: StaffInput): StaffMember {
  requireFeature(db, FEATURES.EMPLOYEE_MANAGEMENT, 'Staff management');
  const i = obj(input, 'Staff member');
  const id = optUuid(i.id, 'staff member');
  const name = text(i.name, 'Name', { max: 60 });
  const role = oneOf(i.role, 'role', ROLES);
  const pin = i.pin === undefined || i.pin === '' ? null : validPin(i.pin);
  const isActive = i.isActive !== false;
  if (!id && !pin) fail('Set a PIN for the new staff member');

  const dup = db
    .prepare(`SELECT 1 FROM users WHERE display_name = ? COLLATE NOCASE AND is_active = 1 AND id IS NOT ?`)
    .get(name, id);
  if (dup) fail(`There is already a staff member called "${name}"`);

  if (id) {
    const r = db
      .prepare(
        `UPDATE users SET display_name = ?, role = ?, is_active = ?, pin_hash = COALESCE(?, pin_hash), updated_at = ? WHERE id = ?`,
      )
      .run(name, role, isActive ? 1 : 0, pin ? hashPin(pin) : null, nowIso(), id);
    if (r.changes === 0) fail('Staff member not found');
    return toStaff(db.prepare(`SELECT id, display_name, role, is_active FROM users WHERE id = ?`).get(id) as Row);
  }
  const newId = randomUUID();
  db.prepare(
    `INSERT INTO users (id, branch_id, username, display_name, pin_hash, role) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(newId, currentBranch(db).id, `staff-${newId.slice(0, 8)}`, name, hashPin(pin!), role);
  return toStaff(db.prepare(`SELECT id, display_name, role, is_active FROM users WHERE id = ?`).get(newId) as Row);
}

/** Cashier switch: tap name + PIN. Wrong PINs get a generic message. */
export function staffLogin(db: Db, staffId: string, pin: string): StaffMember {
  const id = uuid(staffId, 'staff member');
  const p = validPin(pin);
  const row = db
    .prepare(`SELECT id, display_name, role, is_active, pin_hash FROM users WHERE id = ? AND is_active = 1`)
    .get(id) as (Row & { pin_hash: string | null }) | undefined;
  if (!row || !checkPin(p, row.pin_hash)) fail('Wrong PIN. Try again.');
  return toStaff(row);
}

/** Validates the cashier recorded on a sale. Unknown/inactive ids are rejected. */
export function resolveCashier(db: Db, cashierId: unknown): string | null {
  const id = optUuid(cashierId, 'cashier');
  if (!id) return null;
  if (!db.prepare(`SELECT 1 FROM users WHERE id = ? AND is_active = 1`).get(id)) fail('That cashier is no longer active. Switch cashier and try again.');
  return id;
}
