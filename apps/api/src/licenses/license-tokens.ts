import { createPrivateKey, randomInt, sign, type KeyObject } from 'node:crypto';
import type { LicenseTokenPayload } from '@pos/shared-types';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const block = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

/** POS-XXXX-XXXX-XXXX: what a store owner types into the POS once. */
export function generateLicenseKey(): string {
  return `POS-${block()}-${block()}-${block()}`;
}

/** Accepts lower case, spaces, missing dashes. Returns canonical form or null. */
export function normalizeLicenseKey(raw: string): string | null {
  let s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.startsWith('POS') && s.length === 15) s = s.slice(3);
  if (!/^[A-Z0-9]{12}$/.test(s)) return null;
  return `POS-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

export function loadPrivateKey(base64Der: string): KeyObject {
  const key = createPrivateKey({ key: Buffer.from(base64Der, 'base64'), format: 'der', type: 'pkcs8' });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('LICENSE_PRIVATE_KEY must be an Ed25519 key');
  return key;
}

/**
 * Token = base64url(JSON payload) + "." + base64url(Ed25519 signature over the first part).
 * The POS verifies it offline with the public key, so editing its local database
 * can't fake a Professional plan.
 */
export function signLicenseToken(payload: LicenseTokenPayload, key: KeyObject): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = sign(null, Buffer.from(body), key).toString('base64url');
  return `${body}.${sig}`;
}
