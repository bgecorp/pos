import { FEATURES } from '@pos/feature-entitlements';
import { formatMoney, formatQty } from '../../shared/pricing';
import type { AdvancedReport, DateRange, Insight, InventoryAnalytics, InventoryItemAnalytics } from '../../shared/types';
import type { Db } from '../db/database';
import { currentBranch, dayBoundsUtc, localDayModifier, requireFeature, toLocalDate } from './context';
import { IN_RANGE, range } from './reports';
import { getStoreSettings } from './settings';

/** Professional analytics. Everything is computed locally from the POS database. */

// ---------------------------------------------------------------- advanced reports

export function advancedReport(db: Db, input: DateRange): AdvancedReport {
  requireFeature(db, FEATURES.ADVANCED_REPORTS, 'Advanced reports');
  const { limitedFrom: _l, ...p } = range(db, input);
  const q = { ...p, tz: localDayModifier() };
  const done = `${IN_RANGE} AND s.status = 'completed'`;

  const byCashier = (
    db
      .prepare(
        `SELECT s.user_id AS cashierId, COALESCE(u.display_name, 'Not recorded') AS name,
                COUNT(*) AS salesCount, SUM(s.total) AS total
         FROM sales s LEFT JOIN users u ON u.id = s.user_id
         WHERE ${done} GROUP BY s.user_id ORDER BY total DESC`,
      )
      .all(q) as { cashierId: string | null; name: string; salesCount: number; total: number }[]
  ).map((r) => ({ ...r, averageSale: Math.round(r.total / r.salesCount) }));

  const byHour = db
    .prepare(
      `SELECT CAST(strftime('%H', s.created_at, @tz) AS INTEGER) AS hour, COUNT(*) AS salesCount, SUM(s.total) AS total
       FROM sales s WHERE ${done} GROUP BY hour ORDER BY hour`,
    )
    .all(q) as AdvancedReport['byHour'];

  const byWeekday = db
    .prepare(
      `SELECT CAST(strftime('%w', s.created_at, @tz) AS INTEGER) AS weekday, COUNT(*) AS salesCount, SUM(s.total) AS total
       FROM sales s WHERE ${done} GROUP BY weekday ORDER BY weekday`,
    )
    .all(q) as AdvancedReport['byWeekday'];

  const byPayment = db
    .prepare(
      `SELECT pm.method, COUNT(*) AS salesCount, SUM(pm.amount) AS total
       FROM payments pm JOIN sales s ON s.id = pm.sale_id
       WHERE ${done} GROUP BY pm.method ORDER BY total DESC`,
    )
    .all(q) as AdvancedReport['byPayment'];

  const byCategory = db
    .prepare(
      `SELECT COALESCE(c.name, 'No category') AS category, round(SUM(si.quantity), 3) AS quantity,
              SUM(si.line_total) AS revenue,
              SUM(si.line_total - si.tax_amount) - SUM(CAST(round(si.unit_cost * si.quantity) AS INTEGER)) AS profit
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       LEFT JOIN products p ON p.id = si.product_id
       LEFT JOIN categories c ON c.id = p.category_id AND c.deleted_at IS NULL
       WHERE ${done} GROUP BY category ORDER BY revenue DESC`,
    )
    .all(q) as AdvancedReport['byCategory'];

  return { byCashier, byHour, byWeekday, byPayment, byCategory };
}

// ---------------------------------------------------------------- inventory analytics

function computeInventory(db: Db): InventoryAnalytics {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const rows = db
    .prepare(
      `SELECT p.id, p.name, COALESCE(i.quantity, 0) AS stock, p.purchase_price, p.selling_price,
              (SELECT COALESCE(SUM(si.quantity), 0) FROM sale_items si JOIN sales s ON s.id = si.sale_id
                WHERE si.product_id = p.id AND s.status = 'completed' AND s.created_at >= @since) AS sold30,
              (SELECT MAX(s.created_at) FROM sale_items si JOIN sales s ON s.id = si.sale_id
                WHERE si.product_id = p.id AND s.status = 'completed') AS lastSold
       FROM products p LEFT JOIN inventory i ON i.product_id = p.id AND i.branch_id = @branchId
       WHERE p.deleted_at IS NULL AND p.is_active = 1 AND p.track_stock = 1
       ORDER BY p.name COLLATE NOCASE`,
    )
    .all({ since, branchId: currentBranch(db).id }) as {
    id: string;
    name: string;
    stock: number;
    purchase_price: number;
    selling_price: number;
    sold30: number;
    lastSold: string | null;
  }[];

  let cost = 0;
  let retail = 0;
  const items: InventoryItemAnalytics[] = rows.map((r) => {
    const onHand = Math.max(r.stock, 0);
    cost += Math.round(onHand * r.purchase_price);
    retail += Math.round(onHand * r.selling_price);
    const perDay = r.sold30 / 30;
    return {
      productId: r.id,
      name: r.name,
      stock: r.stock,
      soldLast30: Math.round(r.sold30 * 1000) / 1000,
      daysLeft: perDay > 0 ? Math.max(0, Math.floor(r.stock / perDay)) : null,
      lastSoldAt: r.lastSold,
      stockValueCost: Math.round(onHand * r.purchase_price),
    };
  });
  return {
    stockValueCost: cost,
    stockValueRetail: retail,
    trackedProducts: items.length,
    runningOut: items.filter((i) => i.daysLeft !== null && i.daysLeft <= 7).sort((a, b) => a.daysLeft! - b.daysLeft!),
    slowMovers: items.filter((i) => i.stock > 0 && i.soldLast30 === 0).sort((a, b) => b.stockValueCost - a.stockValueCost),
    items,
  };
}

export function inventoryAnalytics(db: Db): InventoryAnalytics {
  requireFeature(db, FEATURES.ADVANCED_INVENTORY, 'Inventory analytics');
  return computeInventory(db);
}

// ---------------------------------------------------------------- insights

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;

/**
 * Plain-language observations from the last 30 days. Rule-based on purpose: it runs
 * offline on the shop PC, explains itself, and never sends sales data anywhere.
 */
export function insights(db: Db): Insight[] {
  requireFeature(db, FEATURES.AI_INSIGHTS, 'Business insights');
  const money = (v: number) => formatMoney(v, getStoreSettings(db).currency);
  const branchId = currentBranch(db).id;
  const out: Insight[] = [];
  const now = new Date();
  const day = (offset: number) => toLocalDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset));
  const net = (from: string, to: string) => {
    const b = dayBoundsUtc(from, to);
    return db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(subtotal - discount_total), 0) AS net, COALESCE(SUM(subtotal), 0) AS gross,
                COALESCE(SUM(discount_total), 0) AS disc
         FROM sales WHERE branch_id = ? AND status = 'completed' AND created_at >= ? AND created_at < ?`,
      )
      .get(branchId, b.start, b.end) as { n: number; net: number; gross: number; disc: number };
  };

  const month = net(day(29), day(0));
  if (month.n === 0) {
    return [{ id: 'no-data', kind: 'info', title: 'Not enough sales yet', detail: 'Insights appear after a few days of selling.' }];
  }

  // Week over week (last 7 days incl. today vs the 7 before)
  const thisWeek = net(day(6), day(0));
  const lastWeek = net(day(13), day(7));
  if (lastWeek.net > 0) {
    const pct = Math.round(((thisWeek.net - lastWeek.net) / lastWeek.net) * 100);
    out.push({
      id: 'wow',
      kind: pct >= 5 ? 'good' : pct <= -5 ? 'warn' : 'info',
      title: pct === 0 ? 'Sales are flat this week' : `Sales ${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% vs last week`,
      detail: `${money(thisWeek.net)} in the last 7 days vs ${money(lastWeek.net)} the week before.`,
    });
  }

  // Busiest hour and best weekday (needs some volume to mean anything)
  if (month.n >= 5) {
    const b = dayBoundsUtc(day(29), day(0));
    const q = { branchId, start: b.start, end: b.end, tz: localDayModifier() };
    const hour = db
      .prepare(
        `SELECT CAST(strftime('%H', created_at, @tz) AS INTEGER) AS h, COUNT(*) AS n, SUM(total) AS t FROM sales
         WHERE branch_id = @branchId AND status = 'completed' AND created_at >= @start AND created_at < @end
         GROUP BY h ORDER BY t DESC LIMIT 1`,
      )
      .get(q) as { h: number; n: number; t: number };
    const wd = db
      .prepare(
        `SELECT CAST(strftime('%w', created_at, @tz) AS INTEGER) AS d, SUM(total) AS t FROM sales
         WHERE branch_id = @branchId AND status = 'completed' AND created_at >= @start AND created_at < @end
         GROUP BY d ORDER BY t DESC LIMIT 1`,
      )
      .get(q) as { d: number; t: number };
    out.push({
      id: 'peak',
      kind: 'info',
      title: `Busiest time: ${WEEKDAYS[wd.d]}s, ${hourLabel(hour.h)}–${hourLabel((hour.h + 1) % 24)}`,
      detail: `Over the last 30 days, ${hourLabel(hour.h)} brought in the most (${money(hour.t)}). Plan staff and restocking around it.`,
    });
  }

  // Best seller
  const b30 = dayBoundsUtc(day(29), day(0));
  const top = db
    .prepare(
      `SELECT MAX(si.name) AS name, SUM(si.line_total) AS revenue, round(SUM(si.quantity), 3) AS qty
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.branch_id = ? AND s.status = 'completed' AND s.created_at >= ? AND s.created_at < ?
       GROUP BY COALESCE(si.product_id, si.name) ORDER BY revenue DESC LIMIT 1`,
    )
    .get(branchId, b30.start, b30.end) as { name: string; revenue: number; qty: number } | undefined;
  if (top) {
    out.push({
      id: 'top',
      kind: 'good',
      title: `Best seller: ${top.name}`,
      detail: `${formatQty(top.qty)} sold for ${money(top.revenue)} in the last 30 days. Keep it in stock.`,
    });
  }

  // Stock
  const inv = computeInventory(db);
  if (inv.runningOut.length) {
    const list = inv.runningOut.slice(0, 3).map((i) => `${i.name} (~${i.daysLeft} day${i.daysLeft === 1 ? '' : 's'})`);
    out.push({
      id: 'running-out',
      kind: 'warn',
      title: `${inv.runningOut.length} product${inv.runningOut.length === 1 ? '' : 's'} may run out within a week`,
      detail: `At the current selling pace: ${list.join(', ')}${inv.runningOut.length > 3 ? ', …' : ''}. Reorder soon.`,
    });
  }
  if (inv.slowMovers.length) {
    const tied = inv.slowMovers.reduce((a, i) => a + i.stockValueCost, 0);
    out.push({
      id: 'slow',
      kind: 'info',
      title: `${inv.slowMovers.length} product${inv.slowMovers.length === 1 ? '' : 's'} didn't sell in 30 days`,
      detail: `${money(tied)} of stock (at cost) is sitting still, e.g. ${inv.slowMovers.slice(0, 3).map((i) => i.name).join(', ')}. Consider a promo or ordering less.`,
    });
  }

  // Margins on items that actually sell
  const thin = db
    .prepare(
      `SELECT p.name, p.purchase_price AS cost, p.selling_price AS price FROM products p
       WHERE p.deleted_at IS NULL AND p.is_active = 1 AND p.purchase_price > 0 AND p.selling_price > 0
         AND (p.selling_price - p.purchase_price) * 10 < p.selling_price
         AND EXISTS (SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
                     WHERE si.product_id = p.id AND s.status = 'completed' AND s.created_at >= ?)
       ORDER BY (p.selling_price - p.purchase_price) * 1.0 / p.selling_price LIMIT 5`,
    )
    .all(b30.start) as { name: string; cost: number; price: number }[];
  const loss = thin.filter((t) => t.price < t.cost);
  if (loss.length) {
    out.push({
      id: 'below-cost',
      kind: 'warn',
      title: `Selling below cost: ${loss.map((t) => t.name).join(', ')}`,
      detail: 'These sell for less than their purchase price. Check the price or the cost.',
    });
  } else if (thin.length) {
    out.push({
      id: 'thin-margin',
      kind: 'warn',
      title: `Thin margins (under 10%) on ${thin.length} selling product${thin.length === 1 ? '' : 's'}`,
      detail: `${thin.slice(0, 3).map((t) => `${t.name} (${Math.round(((t.price - t.cost) / t.price) * 100)}%)`).join(', ')}. A small price change could help.`,
    });
  }

  // Discounts
  if (month.gross > 0 && month.disc / month.gross > 0.1) {
    out.push({
      id: 'discounts',
      kind: 'warn',
      title: `Discounts were ${Math.round((month.disc / month.gross) * 100)}% of sales`,
      detail: `${money(month.disc)} given away in the last 30 days. Make sure they're bringing customers back.`,
    });
  }

  return out;
}
