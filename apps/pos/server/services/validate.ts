/**
 * Tiny input validators for RPC arguments. Every value coming from the browser is
 * untrusted; services call these before touching the database.
 * PosError messages are safe to show the cashier; anything else is reported as unexpected.
 */
export class PosError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PosError';
  }
}

export function fail(message: string): never {
  throw new PosError(message);
}

export function text(v: unknown, label: string, o: { min?: number; max?: number } = {}): string {
  const min = o.min ?? 1;
  const max = o.max ?? 200;
  if (typeof v !== 'string') fail(`${label} is required`);
  const s = v.trim();
  if (s.length < min) fail(min === 1 ? `${label} is required` : `${label} must be at least ${min} characters`);
  if (s.length > max) fail(`${label} must be at most ${max} characters`);
  return s;
}

export function optText(v: unknown, label: string, max = 200): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return null;
  return text(v, label, { max });
}

export function int(v: unknown, label: string, o: { min?: number; max?: number } = {}): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(`${label} must be a whole number`);
  if (o.min !== undefined && v < o.min) fail(`${label} must be at least ${o.min}`);
  if (o.max !== undefined && v > o.max) fail(`${label} must be at most ${o.max}`);
  return v;
}

/** Decimal number rounded to 3 places (quantities like 0.25 kg). */
export function num(v: unknown, label: string, o: { min?: number; max?: number } = {}): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${label} must be a number`);
  if (o.min !== undefined && v < o.min) fail(`${label} must be at least ${o.min}`);
  if (o.max !== undefined && v > o.max) fail(`${label} must be at most ${o.max}`);
  return Math.round(v * 1000) / 1000;
}

export function uuid(v: unknown, label = 'id'): string {
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    fail(`Invalid ${label}`);
  }
  return v;
}

export function optUuid(v: unknown, label: string): string | null {
  return v === undefined || v === null || v === '' ? null : uuid(v, label);
}

export function oneOf<T extends string>(v: unknown, label: string, options: readonly T[]): T {
  if (typeof v !== 'string' || !options.includes(v as T)) fail(`Invalid ${label}`);
  return v as T;
}

export function obj(v: unknown, label: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(`${label} is required`);
  return v as Record<string, unknown>;
}

/** YYYY-MM-DD */
export function dateStr(v: unknown, label: string): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) fail(`Invalid ${label}`);
  return v;
}

export const nowIso = () => new Date().toISOString();
