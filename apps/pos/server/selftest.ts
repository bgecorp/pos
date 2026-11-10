/**
 * POS service tests against a throwaway SQLite file:  npm test -w @pos/pos
 * Uses node:test, so no test framework dependency.
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { calcCart } from '../shared/pricing';
import { getStatus, migrate, openDatabase } from './db/database';
import { LATEST_SCHEMA_VERSION } from './db/migrations';
import { createHandlers } from './handlers';
import { PosError } from './services/validate';

const dir = mkdtempSync(join(tmpdir(), 'pos-test-'));
const db = openDatabase(join(dir, 'pos.sqlite'));
const h = createHandlers(db, { version: 'test' });
after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const rejects = (fn: () => unknown, msg: RegExp) =>
  assert.throws(fn, (e: unknown) => e instanceof PosError && msg.test(e.message));

describe('database', () => {
  test('migrates to latest schema with all 19 tables and is idempotent', () => {
    const s = getStatus(db);
    assert.equal(s.schemaVersion, LATEST_SCHEMA_VERSION);
    assert.equal(s.tables.length, 19);
    assert.equal(migrate(db), LATEST_SCHEMA_VERSION);
  });
  test('seeds a store, current branch and FREE license', () => {
    const info = h['app:info']();
    assert.equal(info.plan, 'FREE');
    assert.ok(info.installId);
    assert.equal(h['settings:getStore']().branchCode, 'MAIN');
  });
});

describe('cart pricing', () => {
  test('no tax, no discount', () => {
    const t = calcCart([{ unitPrice: 2500, quantity: 2, taxRateBps: 0, taxInclusive: true }]);
    assert.deepEqual([t.subtotal, t.discountTotal, t.taxTotal, t.total], [5000, 0, 0, 5000]);
  });
  test('VAT 12% inclusive: total unchanged, tax extracted', () => {
    const t = calcCart([{ unitPrice: 11200, quantity: 1, taxRateBps: 1200, taxInclusive: true }]);
    assert.equal(t.total, 11200);
    assert.equal(t.taxTotal, 1200);
  });
  test('exclusive tax is added on top', () => {
    const t = calcCart([{ unitPrice: 10000, quantity: 1, taxRateBps: 1200, taxInclusive: false }]);
    assert.equal(t.total, 11200);
  });
  test('sale discount is spread across lines and sums exactly', () => {
    const lines = [
      { unitPrice: 333, quantity: 1, taxRateBps: 0, taxInclusive: true },
      { unitPrice: 333, quantity: 1, taxRateBps: 0, taxInclusive: true },
      { unitPrice: 334, quantity: 1, taxRateBps: 0, taxInclusive: true },
    ];
    const t = calcCart(lines, { type: 'fixed', value: 100 });
    assert.equal(t.lines.reduce((a, l) => a + l.discount, 0), 100);
    assert.equal(t.total, 900);
    const pct = calcCart(lines, { type: 'percent', value: 1000 });
    assert.equal(pct.discountTotal, 100);
  });
  test('fixed discount never exceeds the subtotal', () => {
    const t = calcCart([{ unitPrice: 500, quantity: 1, taxRateBps: 0, taxInclusive: true }], { type: 'fixed', value: 9999 });
    assert.equal(t.total, 0);
  });
  test('fractional quantities round to the centavo', () => {
    const t = calcCart([{ unitPrice: 12999, quantity: 0.25, taxRateBps: 0, taxInclusive: true }]);
    assert.equal(t.total, 3250);
  });
});

describe('products and inventory', () => {
  let drinks: string;
  let coke: string;
  test('create category and product with initial stock', () => {
    drinks = h['categories:save']({ name: 'Drinks' }).id;
    const p = h['products:save']({
      name: 'Coke 330ml', sku: 'CK-330', barcode: '4801234567890', categoryId: drinks,
      purchasePrice: 2500, sellingPrice: 3500, trackStock: true, lowStockThreshold: 5, initialStock: 24,
    });
    coke = p.id;
    assert.equal(p.stock, 24);
    assert.equal(p.categoryName, 'Drinks');
    assert.equal(h['categories:list']()[0].productCount, 1);
  });
  test('rejects bad input and duplicate barcode with friendly messages', () => {
    rejects(() => h['products:save']({ name: '', purchasePrice: 0, sellingPrice: 0, trackStock: true }), /name is required/);
    rejects(() => h['products:save']({ name: 'X', purchasePrice: 0, sellingPrice: -1, trackStock: true }), /Selling price/);
    rejects(
      () => h['products:save']({ name: 'Dup', barcode: '4801234567890', purchasePrice: 0, sellingPrice: 100, trackStock: true }),
      /already used by "Coke 330ml"/,
    );
    rejects(() => h['categories:save']({ name: 'drinks' }), /already exists/);
  });
  test('find by barcode or SKU; search by name', () => {
    assert.equal(h['products:findByCode']('4801234567890')?.id, coke);
    assert.equal(h['products:findByCode']('ck-330')?.id, coke);
    assert.equal(h['products:findByCode']('nope'), null);
    assert.equal(h['products:list']({ search: 'coke' }).length, 1);
    assert.equal(h['products:list']({ search: '100%' }).length, 0, 'LIKE wildcards are escaped');
  });
  test('stock adjustments: add, remove, set count; movements recorded', () => {
    assert.equal(h['inventory:adjust']({ productId: coke, mode: 'add', quantity: 6 }).stock, 30);
    assert.equal(h['inventory:adjust']({ productId: coke, mode: 'remove', quantity: 2, note: 'Broken' }).stock, 28);
    assert.equal(h['inventory:adjust']({ productId: coke, mode: 'set', quantity: 27 }).stock, 27);
    const reasons = h['inventory:movements']({ productId: coke }).map((m) => m.reason);
    assert.deepEqual(reasons, ['count', 'adjustment', 'receive', 'receive']);
  });
  test('low-stock detection', () => {
    h['inventory:adjust']({ productId: coke, mode: 'set', quantity: 5 });
    assert.equal(h['products:get'](coke).isLowStock, true);
    assert.equal(h['app:info']().lowStockCount, 1);
    assert.equal(h['products:list']({ lowStockOnly: true }).length, 1);
    h['inventory:adjust']({ productId: coke, mode: 'set', quantity: 50 });
    assert.equal(h['app:info']().lowStockCount, 0);
  });
  test('soft delete frees the barcode for reuse', () => {
    const tmp = h['products:save']({ name: 'Temp', barcode: 'TMP1', purchasePrice: 0, sellingPrice: 100, trackStock: false });
    h['products:delete'](tmp.id);
    assert.equal(h['products:findByCode']('TMP1'), null);
    h['products:save']({ name: 'Temp 2', barcode: 'TMP1', purchasePrice: 0, sellingPrice: 100, trackStock: false });
  });
});

describe('sales', () => {
  let rice: string;
  let soap: string;
  let saleId: string;
  test('setup: taxed product and a non-tracked service item', () => {
    const vat = h['taxes:save']({ name: 'VAT', rateBps: 1200, isInclusive: true, isDefault: true });
    rice = h['products:save']({ name: 'Rice 1kg', purchasePrice: 4500, sellingPrice: 5600, taxId: vat.id, trackStock: true, initialStock: 10 }).id;
    soap = h['products:save']({ name: 'Gift wrap', purchasePrice: 0, sellingPrice: 2000, trackStock: false }).id;
  });
  test('cash sale with discount: totals, change, stock, receipt number', () => {
    const sale = h['sales:create']({
      items: [{ productId: rice, quantity: 2 }, { productId: soap, quantity: 1 }, { productId: rice, quantity: 1 }],
      discount: { type: 'percent', value: 1000 },
      payment: { method: 'cash', tendered: 20000 },
    });
    saleId = sale.id;
    // 3 x 56.00 + 20.00 = 188.00; 10% off = 18.80 -> 169.20; change 30.80
    assert.equal(sale.subtotal, 18800);
    assert.equal(sale.discountTotal, 1880);
    assert.equal(sale.total, 16920);
    assert.equal(sale.payment.change, 3080);
    assert.equal(sale.items.length, 2, 'repeated product lines are merged');
    assert.equal(sale.receiptNumber, 'MAIN-000001');
    assert.ok(sale.taxTotal > 0);
    assert.equal(h['products:get'](rice).stock, 7);
  });
  test('rejects underpayment, empty cart, unknown products', () => {
    rejects(() => h['sales:create']({ items: [{ productId: rice, quantity: 1 }], payment: { method: 'cash', tendered: 100 } }), /less than the total/);
    rejects(() => h['sales:create']({ items: [], payment: { method: 'cash', tendered: 0 } }), /cart is empty/);
    rejects(
      () => h['sales:create']({ items: [{ productId: '00000000-0000-4000-8000-000000000000', quantity: 1 }], payment: { method: 'cash', tendered: 1 } }),
      /no longer available/,
    );
    assert.equal(h['products:get'](rice).stock, 7, 'failed sales do not touch stock');
  });
  test('card sale; numbering continues; selling below zero stock is allowed', () => {
    const s = h['sales:create']({ items: [{ productId: rice, quantity: 8 }], payment: { method: 'card' } });
    assert.equal(s.receiptNumber, 'MAIN-000002');
    assert.equal(s.payment.change, 0);
    assert.equal(h['products:get'](rice).stock, -1);
    h['sales:void'](s.id, 'test');
    assert.equal(h['products:get'](rice).stock, 7);
  });
  test('history, detail and receipt', () => {
    const page = h['sales:list']({ from: today(), to: today() });
    assert.equal(page.total, 2);
    assert.equal(page.limitedFrom, null);
    const html = h['receipts:html'](saleId, { markPrinted: true });
    assert.match(html, /MAIN-000001/);
    assert.match(html, /Rice 1kg/);
    assert.match(html, /VAT \(incl\.\)/);
    assert.doesNotMatch(html, /<script/i);
  });
  test('receipt escapes store text', () => {
    h['settings:saveStore']({ storeName: '<b>Shop</b>', currency: 'PHP', branchName: 'Main' });
    const s = h['sales:create']({ items: [{ productId: soap, quantity: 1 }], payment: { method: 'cash', tendered: 2000 } });
    assert.match(h['receipts:html'](s.id), /&lt;b&gt;Shop&lt;\/b&gt;/);
    h['sales:void'](s.id);
    assert.match(h['receipts:html'](s.id), /VOIDED/);
    rejects(() => h['sales:void'](s.id), /Only completed/);
  });
  test('free plan clamps history to 90 days', () => {
    const page = h['sales:list']({ from: '2020-01-01', to: today() });
    assert.ok(page.limitedFrom, 'clamped');
    assert.equal(page.total, 3);
  });
});

describe('reports', () => {
  test('summary, daily and product sales count completed sales only', () => {
    const r = { from: today(), to: today() };
    const s = h['reports:summary'](r);
    assert.equal(s.salesCount, 1);
    assert.equal(s.voidedCount, 2);
    assert.equal(s.totalCollected, 16920);
    assert.equal(s.netSales, 16920);
    // profit = revenue ex-VAT - cost: rice 3 x 45.00 cost
    assert.equal(s.cost, 13500);
    assert.equal(s.grossProfit, 16920 - s.taxes - 13500);
    const daily = h['reports:daily'](r);
    assert.deepEqual(daily.map((d) => [d.date, d.salesCount]), [[today(), 1]]);
    const prods = h['reports:products'](r);
    assert.deepEqual(prods.map((p) => [p.name, p.quantity]), [['Rice 1kg', 3], ['Gift wrap', 1]]);
  });
  test('rejects inverted ranges', () => {
    rejects(() => h['reports:summary']({ from: '2026-02-01', to: '2026-01-01' }), /after end date/);
  });
});

describe('license', () => {
  // Throwaway key pair + fake licensing API, so no network or real keys are involved.
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  process.env.POS_LICENSE_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const other = generateKeyPairSync('ed25519').privateKey;
  const installId = () => (db.prepare(`SELECT value FROM settings WHERE key = 'install_id'`).get() as { value: string }).value;
  const sign = (p: Record<string, unknown>, key = privateKey) => {
    const body = Buffer.from(JSON.stringify(p)).toString('base64url');
    return `${body}.${cryptoSign(null, Buffer.from(body), key).toString('base64url')}`;
  };
  const payload = (plan: string, o: Record<string, unknown> = {}) => ({
    lid: 'L1', sid: 'S1', uid: 'U1', iid: installId(), plan,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 30 * 86400, ...o,
  });

  let reply: () => Response = () => new Response('{}', { status: 500 });
  let lastBody: Record<string, unknown> = {};
  const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
    lastBody = JSON.parse(String(init?.body));
    return reply();
  }) as typeof fetch;
  const ok = (token: string) => () => Response.json({ token, plan: 'X', expiresAt: '', store: { id: 'S1', name: 'Sari-Sari Online' } });
  const L = createHandlers(db, { version: 'test', apiUrl: 'http://fake', fetch: fakeFetch });

  test('starts unlicensed on FREE', () => {
    const s = L['license:status']();
    assert.equal(s.activated, false);
    assert.equal(s.plan, 'FREE');
  });
  test('activation stores a verified PROFESSIONAL token and lifts the history limit', async () => {
    reply = ok(sign(payload('PROFESSIONAL')));
    const s = await L['license:activate']('pos-abcd-efgh-jkmn');
    assert.equal(lastBody.installId, installId());
    assert.equal(lastBody.licenseKey, 'POS-ABCD-EFGH-JKMN');
    assert.equal(s.plan, 'PROFESSIONAL');
    assert.equal(s.storeName, 'Sari-Sari Online');
    assert.equal(s.licenseKey, 'POS-••••-••••-JKMN');
    assert.equal(L['app:info']().plan, 'PROFESSIONAL');
    assert.equal(L['sales:list']({ from: '2020-01-01', to: today() }).limitedFrom, null);
  });
  test('editing the database cannot fake a plan', () => {
    const real = (db.prepare(`SELECT token FROM license_cache`).get() as { token: string }).token;
    const forged = [
      sign(payload('PROFESSIONAL'), other), // wrong signer
      sign(payload('PROFESSIONAL', { iid: '00000000-0000-4000-8000-000000000000' })), // copied from another PC
      sign(payload('PROFESSIONAL', { exp: Math.floor(Date.now() / 1000) - 60 })), // expired
      Buffer.from(JSON.stringify(payload('PROFESSIONAL'))).toString('base64url') + '.' + real.split('.')[1].replace(/^./, 'A'), // bad sig
      'garbage',
    ];
    for (const t of forged) {
      db.prepare(`UPDATE license_cache SET token = ?, plan = 'PROFESSIONAL'`).run(t);
      assert.equal(L['license:status']().plan, 'FREE', t.slice(0, 20));
    }
    db.prepare(`UPDATE license_cache SET token = ?`).run(real);
    assert.equal(L['license:status']().plan, 'PROFESSIONAL');
  });
  test('offline refresh keeps the cached plan and records the problem', async () => {
    reply = () => {
      throw new TypeError('fetch failed');
    };
    const s = await L['license:refresh']();
    assert.equal(s.plan, 'PROFESSIONAL');
    assert.match(s.lastError ?? '', /Can't reach the licensing server/);
  });
  test('refresh picks up a downgrade, and a server reply signed by someone else is rejected', async () => {
    reply = ok(sign(payload('FREE')));
    assert.equal((await L['license:refresh']()).plan, 'FREE');
    reply = ok(sign(payload('PROFESSIONAL'), other));
    await assert.rejects(L['license:activate']('POS-ABCD-EFGH-JKMN'), /could not be verified/);
    reply = ok(sign(payload('PROFESSIONAL')));
    assert.equal((await L['license:refresh']()).plan, 'PROFESSIONAL');
  });
  test('a replaced/unknown key drops to FREE; server messages reach the cashier', async () => {
    reply = () => Response.json({ message: 'This license key was replaced.' }, { status: 403 });
    const s = await L['license:refresh']();
    assert.equal(s.plan, 'FREE');
    assert.match(s.lastError ?? '', /replaced/);
    reply = () => Response.json({ message: 'License key not found.' }, { status: 404 });
    await assert.rejects(L['license:activate']('POS-ZZZZ-ZZZZ-ZZZZ'), /not found/);
  });
  test('selling works the whole time, and disconnecting returns to FREE', () => {
    const p = h['products:list']({})[0];
    const sale = h['sales:create']({ items: [{ productId: p.id, quantity: 1 }], payment: { method: 'card' } });
    assert.equal(sale.status, 'completed');
    const s = L['license:deactivate']();
    assert.equal(s.activated, false);
    assert.equal(s.plan, 'FREE');
  });
});

describe('professional features', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const installId = () => (db.prepare(`SELECT value FROM settings WHERE key = 'install_id'`).get() as { value: string }).value;
  const token = (plan: string) => {
    const body = Buffer.from(
      JSON.stringify({ lid: 'L', sid: 'S', uid: 'U', iid: installId(), plan, iat: 0, exp: Math.floor(Date.now() / 1000) + 86400 }),
    ).toString('base64url');
    return `${body}.${cryptoSign(null, Buffer.from(body), privateKey).toString('base64url')}`;
  };
  const branches = [
    { id: 'b-main', name: 'Main', code: 'MAIN' },
    { id: 'b-north', name: 'North', code: 'NORTH' },
  ];
  let plan = 'PROFESSIONAL';
  const fakeFetch = (async () =>
    Response.json({ token: token(plan), plan, expiresAt: '', store: { id: 'S', name: 'Pro Store' }, branches })) as unknown as typeof fetch;
  const P = createHandlers(db, { version: 'test', apiUrl: 'http://fake', fetch: fakeFetch });
  const range = () => ({ from: today(), to: today() });
  let maria = '';
  let fast = '';
  let still = '';

  test('Free plan: every Pro operation is refused by the server', () => {
    process.env.POS_LICENSE_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    assert.equal(P['app:info']().plan, 'FREE');
    rejects(() => P['staff:save']({ name: 'X', role: 'cashier', pin: '1234' }), /Professional feature/);
    rejects(() => P['reports:advanced'](range()), /Professional feature/);
    rejects(() => P['reports:inventory'](), /Professional feature/);
    rejects(() => P['insights:list'](), /Professional feature/);
    assert.deepEqual(P['staff:list'](), []);
  });

  test('Professional activation links this POS to the MAIN branch; switching changes receipt codes', async () => {
    await P['license:activate']('POS-PROO-PROO-PROO');
    assert.equal(P['app:info']().plan, 'PROFESSIONAL');
    const opts = P['branch:options']();
    assert.deepEqual(opts.map((b) => [b.code, b.isCurrent]), [['MAIN', true], ['NORTH', false]]);
    P['branch:select']('b-north');
    assert.equal(P['settings:getStore']().branchCode, 'NORTH');
    rejects(() => P['branch:select']('nope'), /Branch not found/);
  });

  test('staff: create with PIN, validation, PIN login', () => {
    rejects(() => P['staff:save']({ name: 'Maria', role: 'cashier' }), /Set a PIN/);
    rejects(() => P['staff:save']({ name: 'Maria', role: 'cashier', pin: '12a4' }), /4 to 6 digits/);
    rejects(() => P['staff:save']({ name: 'Maria', role: 'boss' as never, pin: '1234' }), /Invalid role/);
    maria = P['staff:save']({ name: 'Maria', role: 'cashier', pin: '1234' }).id;
    P['staff:save']({ name: 'Jun', role: 'manager', pin: '987654' });
    rejects(() => P['staff:save']({ name: 'maria', role: 'cashier', pin: '1111' }), /already a staff member/);
    rejects(() => P['staff:login'](maria, '0000'), /Wrong PIN/);
    assert.equal(P['staff:login'](maria, '1234').name, 'Maria');
    assert.deepEqual(P['staff:list']().map((s) => s.name), ['Jun', 'Maria'], 'managers first');
  });

  test('sales record the cashier; receipt shows it; inactive cashiers are refused', () => {
    fast = P['products:save']({ name: 'Fast Seller', purchasePrice: 1000, sellingPrice: 1500, trackStock: true, initialStock: 10 }).id;
    still = P['products:save']({ name: 'Still Item', purchasePrice: 2000, sellingPrice: 3000, trackStock: true, initialStock: 5 }).id;
    const s = P['sales:create']({ items: [{ productId: fast, quantity: 6 }], payment: { method: 'cash', tendered: 10000 }, cashierId: maria });
    assert.equal(s.receiptNumber.split('-')[0], 'NORTH');
    assert.equal(s.cashierName, 'Maria');
    assert.match(P['receipts:html'](s.id), /Cashier: Maria/);
    assert.equal(P['sales:list']({ from: today(), to: today() }).sales[0].cashierName, 'Maria');
    rejects(
      () => P['sales:create']({ items: [{ productId: fast, quantity: 1 }], payment: { method: 'card' }, cashierId: 'bad' }),
      /Invalid cashier/,
    );
    const tmp = P['staff:save']({ name: 'Temp', role: 'cashier', pin: '5555' });
    P['staff:save']({ id: tmp.id, name: 'Temp', role: 'cashier', isActive: false });
    rejects(
      () => P['sales:create']({ items: [{ productId: fast, quantity: 1 }], payment: { method: 'card' }, cashierId: tmp.id }),
      /no longer active/,
    );
    rejects(() => P['staff:login'](tmp.id, '5555'), /Wrong PIN/);
  });

  test('advanced report: cashier, hour, weekday, payment and category breakdowns add up', () => {
    const r = P['reports:advanced'](range());
    const summary = P['reports:summary'](range());
    const sum = (rows: { salesCount: number }[]) => rows.reduce((a, x) => a + x.salesCount, 0);
    assert.equal(sum(r.byCashier), summary.salesCount);
    assert.equal(sum(r.byHour), summary.salesCount);
    assert.equal(sum(r.byWeekday), summary.salesCount);
    assert.ok(r.byCashier.some((c) => c.name === 'Maria' && c.total === 9000 && c.averageSale === 9000));
    assert.ok(r.byCashier.some((c) => c.name === 'Not recorded'));
    assert.ok(r.byPayment.some((p) => p.method === 'cash'));
    assert.ok(r.byCategory.length > 0);
    assert.ok(r.byHour.some((h) => h.hour === new Date().getHours()), 'hours are local time');
  });

  test('inventory analytics: days left, slow movers, stock value', () => {
    const inv = P['reports:inventory']();
    const f = inv.items.find((i) => i.productId === fast)!;
    assert.equal(f.soldLast30, 6);
    assert.equal(f.daysLeft, 20, '4 left at 6 per 30 days');
    const s = inv.items.find((i) => i.productId === still)!;
    assert.equal(s.daysLeft, null);
    assert.ok(inv.slowMovers.some((i) => i.productId === still));
    assert.ok(inv.stockValueRetail >= inv.stockValueCost);
    P['sales:create']({ items: [{ productId: fast, quantity: 3 }], payment: { method: 'card' } });
    const after = P['reports:inventory']();
    assert.ok(after.runningOut.some((i) => i.productId === fast && i.daysLeft === 3), '1 left at 9 per 30 days');
  });

  test('insights explain best seller, stock risks and slow movers', () => {
    const list = P['insights:list']();
    const ids = list.map((i) => i.id);
    assert.ok(ids.includes('top'), ids.join());
    assert.ok(ids.includes('running-out'), ids.join());
    assert.ok(ids.includes('slow'), ids.join());
    assert.match(list.find((i) => i.id === 'running-out')!.detail, /Fast Seller \(~3 days\)/);
    for (const i of list) assert.ok(i.title && i.detail && ['good', 'warn', 'info'].includes(i.kind));
  });

  test('downgrade on refresh locks Pro features again; data is kept', async () => {
    plan = 'FREE';
    await P['license:refresh']();
    rejects(() => P['reports:advanced'](range()), /Professional feature/);
    assert.equal(P['staff:list']().length, 2, 'staff are kept (Maria, Jun)');
    P['license:deactivate']();
  });
});

describe('account link (no license key)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const installId = () => (db.prepare(`SELECT value FROM settings WHERE key = 'install_id'`).get() as { value: string }).value;
  const token = (plan: string) => {
    const body = Buffer.from(
      JSON.stringify({ lid: 'L', sid: 'S9', uid: 'U', iid: installId(), plan, iat: 0, exp: Math.floor(Date.now() / 1000) + 86400 }),
    ).toString('base64url');
    return `${body}.${cryptoSign(null, Buffer.from(body), privateKey).toString('base64url')}`;
  };
  let plan = 'FREE';
  let status = 200;
  const calls: { path: string; auth: string | null; body: Record<string, unknown> }[] = [];
  const fakeFetch = (async (url: unknown, init?: RequestInit) => {
    const path = String(url).replace('http://fake', '');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ path, auth: headers.Authorization ?? null, body: JSON.parse(String(init?.body)) });
    if (status !== 200) return Response.json({ message: 'This POS is signed out.' }, { status });
    if (path === '/pos/subscribe') plan = 'PROFESSIONAL';
    if (path === '/pos/cancel') plan = 'FREE';
    return Response.json({
      token: token(plan),
      plan,
      expiresAt: '',
      store: { id: 'S9', name: "Ana's Store" },
      branches: [{ id: 'b1', name: 'Main', code: 'MAIN' }],
      deviceToken: 'device-123',
      account: { email: 'ana@example.test', fullName: 'Ana Cruz' },
      professionalUntil: plan === 'PROFESSIONAL' ? '2030-01-01T00:00:00.000Z' : null,
      priceMonthly: 49900,
      currency: 'PHP',
    });
  }) as unknown as typeof fetch;
  const A = createHandlers(db, { version: 'test', apiUrl: 'http://fake', fetch: fakeFetch });

  test('signed out at first; subscribing needs sign-in', async () => {
    process.env.POS_LICENSE_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const s = A['license:status']();
    assert.equal(s.signedIn, false);
    await assert.rejects(A['account:subscribe'](), /Sign in first/);
  });
  test('the link code from the website signs this POS in', async () => {
    const s = await A['account:connect']('LINK-CODE');
    assert.equal(calls.at(-1)!.path, '/pos/connect');
    assert.equal(calls.at(-1)!.body.linkCode, 'LINK-CODE');
    assert.equal(calls.at(-1)!.body.installId, installId());
    assert.equal(s.signedIn, true);
    assert.equal(s.account?.email, 'ana@example.test');
    assert.equal(s.plan, 'FREE');
    assert.equal(s.priceMonthly, 49900);
    assert.equal(s.storeName, "Ana's Store");
  });
  test('Subscribe turns Professional on; refresh and cancel use the device token', async () => {
    const s = await A['account:subscribe']();
    assert.equal(calls.at(-1)!.auth, 'Bearer device-123');
    assert.equal(s.plan, 'PROFESSIONAL');
    assert.equal(s.professionalUntil, '2030-01-01T00:00:00.000Z');
    assert.equal(A['app:info']().plan, 'PROFESSIONAL');
    assert.doesNotThrow(() => A['reports:inventory']());
    await A['license:refresh']();
    assert.equal(calls.at(-1)!.path, '/pos/refresh');
    const c = await A['account:cancel']();
    assert.equal(c.plan, 'FREE');
    rejects(() => A['reports:inventory'](), /Professional feature/);
  });
  test('a rejected device token signs the POS out (Free) but keeps selling', async () => {
    plan = 'PROFESSIONAL';
    await A['account:subscribe']();
    status = 401;
    const s = await A['license:refresh']();
    assert.equal(s.plan, 'FREE');
    assert.equal(s.signedIn, false);
    const p = A['products:list']({})[0];
    assert.equal(A['sales:create']({ items: [{ productId: p.id, quantity: 1 }], payment: { method: 'card' } }).status, 'completed');
    status = 200;
  });
  test('sign out clears the account', async () => {
    await A['account:connect']('LINK-2');
    const s = A['license:deactivate']();
    assert.equal(s.signedIn, false);
    assert.equal(s.account, null);
  });
});
