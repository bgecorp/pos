import { hasFeature, PLAN_LIMITS, type Feature } from '@pos/feature-entitlements';
import type { Db } from '../db/database';
import { licensePublicKey } from '../license-public-key';
import { effectivePlan } from './license';
import { fail } from './validate';

export interface CurrentBranch {
  id: string;
  code: string;
  name: string;
  storeId: string;
}

/** The branch this installation operates as (exactly one row has is_current = 1). */
export function currentBranch(db: Db): CurrentBranch {
  const b = db
    .prepare(`SELECT id, code, name, store_id AS storeId FROM branches WHERE is_current = 1 LIMIT 1`)
    .get() as CurrentBranch | undefined;
  return b ?? fail('No branch configured');
}

/** Effective plan from the cached, signature-verified license token (see services/license.ts). */
export function currentPlan(db: Db): 'FREE' | 'PROFESSIONAL' {
  return effectivePlan(db, licensePublicKey());
}

/** Server-side gate for Professional operations (the screens also hide them). */
export function requireFeature(db: Db, feature: Feature, label: string): void {
  if (!hasFeature(currentPlan(db), feature)) {
    fail(`${label} is a Professional feature. Activate a Professional license in Settings → License.`);
  }
}

/** Local calendar days [from, to] -> UTC ISO bounds [start, end) for querying created_at. */
export function dayBoundsUtc(from: string, to: string): { start: string; end: string } {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return { start: new Date(fy, fm - 1, fd).toISOString(), end: new Date(ty, tm - 1, td + 1).toISOString() };
}

/**
 * Free plan: reports and sales history only look back N days (data is never deleted).
 * Returns the clamped start and, when clamping happened, the local date it was clamped to.
 */
export function clampHistory(db: Db, start: string): { start: string; limitedFrom: string | null } {
  const days = PLAN_LIMITS[currentPlan(db)].salesHistoryDays;
  if (days === null) return { start, limitedFrom: null };
  const now = new Date();
  const earliest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  if (start >= earliest.toISOString()) return { start, limitedFrom: null };
  return { start: earliest.toISOString(), limitedFrom: toLocalDate(earliest) };
}

export function toLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** SQLite date() modifier that converts stored UTC timestamps to this machine's local day. */
export function localDayModifier(): string {
  return `${-new Date().getTimezoneOffset()} minutes`;
}
