import { randomInt } from 'node:crypto';

/** No 0/O, 1/I/L: codes get read aloud and typed from chat messages. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

const block = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

/** PRO-XXXX-XXXX: 31^8 ≈ 850 billion combinations, plus rate-limited redemption. */
export function generateCode(): string {
  return `PRO-${block()}-${block()}`;
}

/** Accepts "pro 7kq2 m9xd", "PRO7KQ2M9XD", "7KQ2-M9XD"... Returns canonical form or null. */
export function normalizeCode(raw: string): string | null {
  let s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.startsWith('PRO') && s.length === 11) s = s.slice(3);
  if (!/^[A-Z0-9]{8}$/.test(s)) return null;
  return `PRO-${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Adds calendar months, clamping to the last day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}
