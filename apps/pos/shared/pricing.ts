/**
 * Cart math shared by the cashier screen (live totals) and the main process
 * (authoritative totals when a sale is saved). Pure functions, integer centavos.
 */

export interface PricingLine {
  unitPrice: number;
  quantity: number;
  taxRateBps: number;
  taxInclusive: boolean;
}

export interface PricingDiscount {
  type: 'percent' | 'fixed';
  /** bps for percent (1000 = 10%), minor units for fixed */
  value: number;
}

export interface PricedLine {
  gross: number;
  discount: number;
  tax: number;
  /** What the customer pays for this line: gross - discount (+ tax if exclusive) */
  total: number;
}

export interface CartTotals {
  lines: PricedLine[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

export function calcCart(lines: PricingLine[], discount?: PricingDiscount | null): CartTotals {
  const gross = lines.map((l) => Math.round(l.unitPrice * l.quantity));
  const subtotal = gross.reduce((a, b) => a + b, 0);

  let discountTotal = 0;
  if (discount && subtotal > 0) {
    discountTotal =
      discount.type === 'percent'
        ? Math.round((subtotal * Math.min(Math.max(discount.value, 0), 10_000)) / 10_000)
        : Math.min(Math.max(discount.value, 0), subtotal);
  }

  // Spread the sale discount across lines in proportion to their value (so tax is
  // computed on what was actually charged). Floor first, then hand out leftover centavos.
  const alloc = gross.map((g) => (subtotal > 0 ? Math.floor((discountTotal * g) / subtotal) : 0));
  let leftover = discountTotal - alloc.reduce((a, b) => a + b, 0);
  for (let i = 0; leftover > 0 && i < alloc.length; i = (i + 1) % alloc.length) {
    if (alloc[i] < gross[i]) {
      alloc[i]++;
      leftover--;
    }
  }

  const priced = lines.map((l, i): PricedLine => {
    const net = gross[i] - alloc[i];
    const rate = l.taxRateBps / 10_000;
    const tax = rate <= 0 ? 0 : l.taxInclusive ? Math.round(net - net / (1 + rate)) : Math.round(net * rate);
    return { gross: gross[i], discount: alloc[i], tax, total: net + (l.taxInclusive ? 0 : tax) };
  });

  return {
    lines: priced,
    subtotal,
    discountTotal,
    taxTotal: priced.reduce((a, l) => a + l.tax, 0),
    total: priced.reduce((a, l) => a + l.total, 0),
  };
}

export function formatMoney(minor: number, currency = 'PHP'): string {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency }).format(minor / 100);
}

/** "12.5" / "₱1,234.50" -> 1250 / 123450. Returns null for invalid input. */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[^\d.]/g, '');
  if (!cleaned || !/^\d*\.?\d{0,2}$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

/** 1250 -> "12.50" for editable inputs */
export function toInputMoney(minor: number): string {
  return (minor / 100).toFixed(2);
}

export function formatQty(q: number): string {
  return Number.isInteger(q) ? String(q) : String(Math.round(q * 1000) / 1000);
}
