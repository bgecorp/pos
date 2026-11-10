import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { hostname } from 'node:os';
import type { LicenseActivateResponse, LicenseTokenPayload, PosConnectResponse } from '@pos/shared-types';
import type { BranchOption, LicenseStatus } from '../../shared/types';
import type { Db } from '../db/database';
import { fail, nowIso, PosError, text } from './validate';

/**
 * License = a token signed by the SaaS API (Ed25519). The POS stores it in
 * license_cache and re-verifies the signature whenever it needs the plan, so the
 * plan can't be upgraded by editing the database. Selling never depends on this.
 */

export interface LicenseDeps {
  apiUrl: string;
  publicKey: string;
  appVersion: string;
  fetch?: typeof fetch;
}

const keyCache = new Map<string, KeyObject>();
function publicKeyObject(base64: string): KeyObject {
  let k = keyCache.get(base64);
  if (!k) {
    k = createPublicKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'spki' });
    keyCache.set(base64, k);
  }
  return k;
}

/** Returns the payload if the signature is valid and the token belongs to this install. */
export function verifyToken(token: string, installId: string, publicKey: string): LicenseTokenPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    if (!verify(null, Buffer.from(body), publicKeyObject(publicKey), Buffer.from(sig, 'base64url'))) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LicenseTokenPayload;
    if (p.iid !== installId || (p.plan !== 'FREE' && p.plan !== 'PROFESSIONAL') || typeof p.exp !== 'number') return null;
    return p;
  } catch {
    return null;
  }
}

interface CacheRow {
  license_key: string | null;
  token: string | null;
  plan: string;
  remote_store_id: string | null;
  expires_at: string | null;
  last_verified_at: string | null;
}

const readCache = (db: Db) => db.prepare(`SELECT * FROM license_cache WHERE id = 1`).get() as CacheRow;
const installId = (db: Db) =>
  (db.prepare(`SELECT value FROM settings WHERE key = 'install_id'`).get() as { value: string }).value;
const setSetting = (db: Db, key: string, value: string | null) =>
  value === null
    ? db.prepare(`DELETE FROM settings WHERE key = ?`).run(key)
    : db
        .prepare(
          `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .run(key, value, nowIso());

/** The plan this POS may use right now, from a verified, unexpired token. FREE otherwise. */
export function effectivePlan(db: Db, publicKey: string): 'FREE' | 'PROFESSIONAL' {
  const row = readCache(db);
  if (!row?.token) return 'FREE';
  const p = verifyToken(row.token, installId(db), publicKey);
  return p && p.plan === 'PROFESSIONAL' && p.exp * 1000 > Date.now() ? 'PROFESSIONAL' : 'FREE';
}

export function getLicenseStatus(db: Db, deps: Pick<LicenseDeps, 'publicKey'>): LicenseStatus {
  const row = readCache(db);
  const valid = row.token ? verifyToken(row.token, installId(db), deps.publicKey) : null;
  const key = row.license_key;
  const get = (k: string) => (db.prepare(`SELECT value FROM settings WHERE key = ?`).get(k) as { value: string } | undefined)?.value ?? null;
  const accountJson = get('account');
  const account = accountJson ? (JSON.parse(accountJson) as LicenseStatus['account']) : null;
  const signedIn = !!get('account_device_token');
  return {
    activated: !!key || signedIn,
    signedIn,
    account,
    professionalUntil: get('account_pro_until'),
    priceMonthly: get('account_price') === null ? null : Number(get('account_price')),
    currency: get('account_currency') ?? 'PHP',
    licenseKey: key ? `${key.slice(0, 4)}••••-••••-${key.slice(-4)}` : null,
    plan: effectivePlan(db, deps.publicKey),
    storeName: (db.prepare(`SELECT value FROM settings WHERE key = 'license_store_name'`).get() as { value: string } | undefined)?.value ?? null,
    expiresAt: valid ? new Date(valid.exp * 1000).toISOString() : null,
    lastVerifiedAt: row.last_verified_at,
    lastError: (db.prepare(`SELECT value FROM settings WHERE key = 'license_last_error'`).get() as { value: string } | undefined)?.value ?? null,
  };
}

class LicenseServerError extends PosError {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function callActivate(db: Db, key: string, deps: LicenseDeps): Promise<LicenseActivateResponse> {
  return callApi<LicenseActivateResponse>(db, '/licenses/activate', { licenseKey: key }, deps);
}

/** POSTs to the SaaS API with this install's identity; maps failures to cashier-friendly errors. */
async function callApi<T extends { token: string }>(
  db: Db,
  apiPath: string,
  extra: Record<string, unknown>,
  deps: LicenseDeps,
  bearer?: string,
): Promise<T> {
  const doFetch = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${deps.apiUrl}${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify({ ...extra, installId: installId(db), deviceName: hostname().slice(0, 100), appVersion: deps.appVersion }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new LicenseServerError("Can't reach the licensing server. Check the internet connection and try again.", 0);
  }
  const body = (await res.json().catch(() => null)) as (T & { message?: string | string[] }) | null;
  if (!res.ok || !body?.token) {
    const m = body?.message;
    throw new LicenseServerError(Array.isArray(m) ? m.join('. ') : (m ?? `Licensing server error (${res.status})`), res.status);
  }
  return body;
}

function saveToken(db: Db, key: string | null, r: LicenseActivateResponse | PosConnectResponse, deps: LicenseDeps) {
  const p = verifyToken(r.token, installId(db), deps.publicKey);
  if (!p) fail("The licensing server's reply could not be verified. Make sure this POS is up to date.");
  const now = nowIso();
  db.transaction(() => {
    db.prepare(
      `UPDATE license_cache SET license_key = ?, token = ?, plan = ?, remote_store_id = ?, expires_at = ?,
         last_verified_at = ?, updated_at = ? WHERE id = 1`,
    ).run(key, r.token, p.plan, p.sid, new Date(p.exp * 1000).toISOString(), now, now);
    db.prepare(`UPDATE stores SET remote_store_id = ?, updated_at = ? WHERE id = (SELECT store_id FROM branches WHERE is_current = 1)`).run(p.sid, now);
    // Adopt the website's store name if this POS still has the default one.
    db.prepare(
      `UPDATE stores SET name = ? WHERE name = 'My Store' AND id = (SELECT store_id FROM branches WHERE is_current = 1)`,
    ).run(r.store.name.slice(0, 100));
    setSetting(db, 'license_store_name', r.store.name);
    setSetting(db, 'license_last_error', null);
    if ('deviceToken' in r) {
      setSetting(db, 'account_device_token', r.deviceToken);
      setSetting(db, 'account', JSON.stringify(r.account));
      setSetting(db, 'account_pro_until', r.professionalUntil);
      setSetting(db, 'account_price', String(r.priceMonthly));
      setSetting(db, 'account_currency', r.currency);
    }
    const branches = Array.isArray(r.branches) ? r.branches : [];
    setSetting(db, 'license_branches', JSON.stringify(branches));
    // First activation: link this POS to the website's MAIN (or first) branch.
    const local = db.prepare(`SELECT id, remote_branch_id FROM branches WHERE is_current = 1`).get() as
      | { id: string; remote_branch_id: string | null }
      | undefined;
    if (local && !local.remote_branch_id && branches.length) {
      const pick = branches.find((b) => b.code === 'MAIN') ?? branches[0];
      linkBranch(db, local.id, pick);
    }
  })();
}

function linkBranch(db: Db, localId: string, b: { id: string; name: string; code: string }) {
  db.prepare(`UPDATE branches SET remote_branch_id = ?, name = ?, code = ?, updated_at = ? WHERE id = ?`).run(
    b.id, b.name.slice(0, 60), b.code.slice(0, 16), nowIso(), localId,
  );
}

/** The store's branches (from the last activation) and which one this POS is. */
export function branchOptions(db: Db): BranchOption[] {
  const raw = (db.prepare(`SELECT value FROM settings WHERE key = 'license_branches'`).get() as { value: string } | undefined)?.value;
  const list = raw ? (JSON.parse(raw) as { id: string; name: string; code: string }[]) : [];
  const current = (db.prepare(`SELECT remote_branch_id FROM branches WHERE is_current = 1`).get() as { remote_branch_id: string | null })
    .remote_branch_id;
  return list.map((b) => ({ remoteId: b.id, name: b.name, code: b.code, isCurrent: b.id === current }));
}

/**
 * Sets which website branch this computer is. New receipts use that branch's code;
 * past sales keep their numbers. Each branch keeps its own POS database.
 */
export function selectBranch(db: Db, remoteId: string): BranchOption[] {
  const pick = branchOptions(db).find((b) => b.remoteId === remoteId);
  if (!pick) fail('Branch not found. Click Check now to load the latest branches.');
  const local = db.prepare(`SELECT id FROM branches WHERE is_current = 1`).get() as { id: string };
  linkBranch(db, local.id, { id: pick.remoteId, name: pick.name, code: pick.code });
  return branchOptions(db);
}

/** Owner enters the key from the website. Needs internet once. */
export async function activateLicense(db: Db, licenseKey: string, deps: LicenseDeps): Promise<LicenseStatus> {
  const key = text(licenseKey, 'License key', { max: 40 }).toUpperCase();
  const r = await callActivate(db, key, deps);
  saveToken(db, key, r, deps);
  return getLicenseStatus(db, deps);
}

/**
 * Background/manual refresh. Network problems keep the cached token (offline grace
 * until it expires). A key the server rejects (replaced/unknown) drops to FREE.
 */
export async function refreshLicense(db: Db, deps: LicenseDeps): Promise<LicenseStatus> {
  const device = deviceToken(db);
  const key = readCache(db).license_key;
  if (!device && !key) return getLicenseStatus(db, deps);
  try {
    if (device) saveToken(db, null, await callApi<PosConnectResponse>(db, '/pos/refresh', {}, deps, device), deps);
    else saveToken(db, key, await callActivate(db, key!, deps), deps);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setSetting(db, 'license_last_error', msg);
    if (err instanceof LicenseServerError && [401, 403, 404].includes(err.status)) {
      db.prepare(`UPDATE license_cache SET token = NULL, plan = 'FREE', expires_at = NULL, updated_at = ? WHERE id = 1`).run(nowIso());
      if (err.status === 401) setSetting(db, 'account_device_token', null);
    }
  }
  return getLicenseStatus(db, deps);
}

/** Disconnects this POS from the store's license. Sales data is untouched. */
export function deactivateLicense(db: Db, deps: Pick<LicenseDeps, 'publicKey'>): LicenseStatus {
  db.transaction(() => {
    db.prepare(
      `UPDATE license_cache SET license_key = NULL, token = NULL, plan = 'FREE', remote_store_id = NULL,
         expires_at = NULL, last_verified_at = NULL, updated_at = ? WHERE id = 1`,
    ).run(nowIso());
    setSetting(db, 'license_store_name', null);
    setSetting(db, 'license_last_error', null);
    setSetting(db, 'license_branches', null);
    for (const k of ['account_device_token', 'account', 'account_pro_until', 'account_price', 'account_currency']) setSetting(db, k, null);
    db.prepare(`UPDATE branches SET remote_branch_id = NULL WHERE is_current = 1`).run();
  })();
  return getLicenseStatus(db, deps);
}

// ---------------------------------------------------------------- account link (no license key)

const deviceToken = (db: Db) =>
  (db.prepare(`SELECT value FROM settings WHERE key = 'account_device_token'`).get() as { value: string } | undefined)?.value ?? null;

/** The website opened the POS with a one-time link code: sign this POS in to that account. */
export async function connectAccount(db: Db, linkCode: string, deps: LicenseDeps): Promise<LicenseStatus> {
  const code = text(linkCode, 'Sign-in link', { max: 2000 });
  const r = await callApi<PosConnectResponse>(db, '/pos/connect', { linkCode: code }, deps);
  db.prepare(`UPDATE license_cache SET license_key = NULL WHERE id = 1`).run();
  saveToken(db, null, r, deps);
  return getLicenseStatus(db, deps);
}

async function withDevice(db: Db, apiPath: string, deps: LicenseDeps): Promise<LicenseStatus> {
  const device = deviceToken(db);
  if (!device) fail('Sign in first: open the POS from the website.');
  saveToken(db, null, await callApi<PosConnectResponse>(db, apiPath, {}, deps, device), deps);
  return getLicenseStatus(db, deps);
}

/** Subscribe to Professional from inside the POS (needs internet). */
export const subscribePro = (db: Db, deps: LicenseDeps) => withDevice(db, '/pos/subscribe', deps);

/** Cancel Professional; the POS returns to Free right away. */
export const cancelPro = (db: Db, deps: LicenseDeps) => withDevice(db, '/pos/cancel', deps);
