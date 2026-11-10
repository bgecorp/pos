import type { DailySalesRow, DateRange, ProductSalesRow, SalesSummaryReport } from '../../shared/types';
import type { Db } from '../db/database';
import { clampHistory, currentBranch, dayBoundsUtc, localDayModifier } from './context';
import { dateStr, fail, int, obj } from './validate';

/** Free plan reports: summary, daily sales, product sales. Only completed sales count. */

export function range(db: Db, input: DateRange) {
  const r = obj(input, 'Date range');
  const from = dateStr(r.from, 'start date');
  const to = dateStr(r.to, 'end date');
  if (from > to) fail('Start date is after end date');
  const bounds = dayBoundsUtc(from, to);
  const clamped = clampHistory(db, bounds.start);
  return { branchId: currentBranch(db).id, start: clamped.start, end: bounds.end, limitedFrom: clamped.limitedFrom };
}

export const IN_RANGE = `s.branch_id = @branchId AND s.created_at >= @start AND s.created_at < @end`;

export function salesSummary(db: Db, input: DateRange): SalesSummaryReport {
  const { limitedFrom, ...p } = range(db, input);
  const s = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(subtotal), 0) AS gross, COALESCE(SUM(discount_total), 0) AS disc,
              COALESCE(SUM(tax_total), 0) AS tax, COALESCE(SUM(total), 0) AS total
       FROM sales s WHERE ${IN_RANGE} AND s.status = 'completed'`,
    )
    .get(p) as { n: number; gross: number; disc: number; tax: number; total: number };
  // Revenue excluding tax minus cost. line_total - tax_amount is the net-of-tax amount
  // for both tax-inclusive and tax-exclusive items.
  const c = db
    .prepare(
      `SELECT COALESCE(SUM(si.line_total - si.tax_amount), 0) AS revenue,
              COALESCE(SUM(CAST(round(si.unit_cost * si.quantity) AS INTEGER)), 0) AS cost
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE ${IN_RANGE} AND s.status = 'completed'`,
    )
    .get(p) as { revenue: number; cost: number };
  const { voided } = db
    .prepare(`SELECT COUNT(*) AS voided FROM sales s WHERE ${IN_RANGE} AND s.status = 'voided'`)
    .get(p) as { voided: number };
  return {
    salesCount: s.n,
    voidedCount: voided,
    grossSales: s.gross,
    discounts: s.disc,
    netSales: s.gross - s.disc,
    taxes: s.tax,
    totalCollected: s.total,
    cost: c.cost,
    grossProfit: c.revenue - c.cost,
    averageSale: s.n ? Math.round(s.total / s.n) : 0,
    limitedFrom,
  };
}

export function dailySales(db: Db, input: DateRange): DailySalesRow[] {
  const { limitedFrom: _ignored, ...p } = range(db, input);
  return db
    .prepare(
      `SELECT date(s.created_at, @tz) AS date, COUNT(*) AS salesCount,
              SUM(s.subtotal - s.discount_total) AS netSales, SUM(s.total) AS totalCollected
       FROM sales s WHERE ${IN_RANGE} AND s.status = 'completed'
       GROUP BY date(s.created_at, @tz) ORDER BY date`,
    )
    .all({ ...p, tz: localDayModifier() }) as DailySalesRow[];
}

export function productSales(db: Db, input: DateRange & { limit?: number }): ProductSalesRow[] {
  const { limitedFrom: _ignored, ...p } = range(db, input);
  const limit = input.limit === undefined ? 50 : int(input.limit, 'limit', { min: 1, max: 500 });
  return db
    .prepare(
      `SELECT si.product_id AS productId, MAX(si.name) AS name, round(SUM(si.quantity), 3) AS quantity,
              SUM(si.line_total) AS revenue,
              SUM(si.line_total - si.tax_amount) - SUM(CAST(round(si.unit_cost * si.quantity) AS INTEGER)) AS profit
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE ${IN_RANGE} AND s.status = 'completed'
       GROUP BY COALESCE(si.product_id, si.name)
       ORDER BY revenue DESC LIMIT @limit`,
    )
    .all({ ...p, limit }) as ProductSalesRow[];
}
