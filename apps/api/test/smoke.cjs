/**
 * End-to-end smoke test for Phase 2 API flows, run against a live API:
 *   npm run start -w @pos/api        (in another terminal)
 *   npm run test:smoke -w @pos/api
 * Creates a throwaway user (smoke-*@example.test) and deletes it at the end.
 */
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const email = `smoke-${Date.now()}@example.test`;
const password = 'smoke-pass-123';
let token = '';

async function call(method, path, body, expectStatus) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (expectStatus) assert.equal(res.status, expectStatus, `${method} ${path} -> ${res.status} ${text}`);
  return json;
}

const steps = [];
const step = (name, fn) => steps.push([name, fn]);

let storeId;
let branchId;
let otherToken = '';
const codes = [];

step('health reports database up', async () => {
  const h = await call('GET', '/health', null, 200);
  assert.equal(h.database, 'up');
});
step('plans are public and seeded', async () => {
  const plans = await call('GET', '/plans', null, 200);
  assert.deepEqual(plans.map((p) => p.code), ['FREE', 'PROFESSIONAL']);
  assert.equal(plans[0].limits.stores, 1);
});
step('protected route rejects missing token', () => call('GET', '/stores', null, 401));
step('register rejects invalid input', async () => {
  const err = await call('POST', '/auth/register', { email: 'nope', password: '1', fullName: '' }, 400);
  assert.ok(Array.isArray(err.message) && err.message.length >= 3);
});
step('register creates account on FREE plan', async () => {
  const r = await call('POST', '/auth/register', { email: email.toUpperCase(), password, fullName: 'Smoke Test' }, 201);
  assert.equal(r.user.email, email, 'email is normalized to lowercase');
  assert.equal(r.user.plan, 'FREE');
  assert.ok(r.accessToken);
});
step('duplicate registration is rejected', () =>
  call('POST', '/auth/register', { email, password, fullName: 'Again' }, 409),
);
step('login with wrong password fails', () => call('POST', '/auth/login', { email, password: 'wrong-pass' }, 401));
step('login succeeds and /auth/me works', async () => {
  const r = await call('POST', '/auth/login', { email, password }, 200);
  token = r.accessToken;
  const me = await call('GET', '/auth/me', null, 200);
  assert.equal(me.email, email);
  assert.ok(me.features.includes('cashier'));
  assert.ok(!me.features.includes('multi_branch'));
});
step('registration created the store with a Main branch', async () => {
  const stores = await call('GET', '/stores', null, 200);
  assert.equal(stores.length, 1);
  storeId = stores[0].id;
  assert.equal(stores[0].name, "Smoke's Store");
  assert.equal(stores[0].currency, 'PHP');
  assert.deepEqual(stores[0].branches.map((b) => b.code), ['MAIN']);
});
step('FREE plan blocks a second store', () => call('POST', '/stores', { name: 'Second' }, 403));
step('FREE plan blocks a second branch', () =>
  call('POST', `/stores/${storeId}/branches`, { name: 'North', code: 'NORTH' }, 403),
);
step('update store', async () => {
  const s = await call('PATCH', `/stores/${storeId}`, { name: 'Renamed Store' }, 200);
  assert.equal(s.name, 'Renamed Store');
});
step('PROFESSIONAL plan unlocks branches and stores', async () => {
  const prisma = new PrismaClient();
  const me = await call('GET', '/auth/me', null, 200);
  await prisma.subscription.create({
    data: { userId: me.id, planCode: 'PROFESSIONAL', currentPeriodStart: new Date() },
  });
  await prisma.$disconnect();
  const s = await call('POST', `/stores/${storeId}/branches`, { name: 'North', code: 'north' }, 201);
  assert.deepEqual(s.branches.map((b) => b.code), ['MAIN', 'NORTH']);
  branchId = s.branches[1].id;
  await call('POST', `/stores/${storeId}/branches`, { name: 'Dup', code: 'NORTH' }, 409);
  const second = await call('POST', '/stores', { name: 'Second Store' }, 201);
  await call('DELETE', `/stores/${second.id}`, null, 204);
});
step('remove branch; last branch is protected', async () => {
  const s = await call('DELETE', `/stores/${storeId}/branches/${branchId}`, null, 200);
  await call('DELETE', `/stores/${storeId}/branches/${s.branches[0].id}`, null, 400);
});
step('change password, then log in with the new one', async () => {
  await call('POST', '/account/password', { currentPassword: 'bad-current', newPassword: 'new-pass-456' }, 400);
  await call('POST', '/account/password', { currentPassword: password, newPassword: 'new-pass-456' }, 204);
  await call('POST', '/auth/login', { email, password: 'new-pass-456' }, 200);
});
step('update account name', async () => {
  const me = await call('PATCH', '/account', { fullName: '  New Name  ' }, 200);
  assert.equal(me.fullName, 'New Name');
});
step("other users cannot see this store", async () => {
  const other = await call('POST', '/auth/register', { email: `x-${email}`, password, fullName: 'Other' }, 201);
  const mine = token;
  token = otherToken = other.accessToken;
  await call('GET', `/stores/${storeId}`, null, 404);
  token = mine;
});

// ---- Phase 4: admin + upgrade codes ------------------------------------------------
const as = async (t, ...args) => { const keep = token; token = t; try { return await call(...args); } finally { token = keep; } };

step('non-admins cannot use admin endpoints', () => call('GET', '/admin/overview', null, 403));
step('admin can generate upgrade codes', async () => {
  const prisma = new PrismaClient();
  await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
  await prisma.$disconnect();
  const me = await call('GET', '/auth/me', null, 200);
  assert.equal(me.role, 'ADMIN');
  await call('POST', '/admin/codes', { count: 0, months: 1 }, 400);
  const created = await call('POST', '/admin/codes', { count: 3, months: 1, note: 'smoke' }, 201);
  assert.equal(created.length, 3);
  for (const c of created) assert.match(c.code, /^PRO-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  codes.push(...created);
  const unused = await call('GET', '/admin/codes?status=UNUSED', null, 200);
  assert.ok(created.every((c) => unused.some((u) => u.id === c.id)));
});
step('customer redeems a code and gets Professional for 1 month', async () => {
  const before = await as(otherToken, 'GET', '/subscription', null, 200);
  assert.equal(before.plan, 'FREE');
  const r = await as(otherToken, 'POST', '/subscription/redeem', { code: codes[0].code }, 200);
  assert.equal(r.user.plan, 'PROFESSIONAL');
  assert.ok(r.user.features.includes('multi_branch'));
  const days = (Date.parse(r.professionalUntil) - Date.now()) / 86400000;
  assert.ok(days > 27 && days < 32, 'about one month: ' + days);
});
step('a code cannot be used twice; junk codes are rejected', async () => {
  const again = await as(otherToken, 'POST', '/subscription/redeem', { code: codes[0].code }, 400);
  assert.match(again.message, /already been used/);
  await as(otherToken, 'POST', '/subscription/redeem', { code: 'PRO-AAAA-AAAA' }, 400);
});
step('second code stacks another month; typed loosely is accepted', async () => {
  const loose = codes[1].code.toLowerCase().replace(/-/g, ' ');
  const r = await as(otherToken, 'POST', '/subscription/redeem', { code: loose }, 200);
  const days = (Date.parse(r.professionalUntil) - Date.now()) / 86400000;
  assert.ok(days > 56 && days < 63, 'about two months: ' + days);
  const sub = await as(otherToken, 'GET', '/subscription', null, 200);
  assert.equal(sub.payments.length, 2);
  assert.equal(sub.payments[0].status, 'PAID');
  assert.equal(sub.payments[0].amount, 49900);
  assert.equal(sub.subscriptions.filter((s) => s.isCurrent).length, 1, 'extended, not duplicated');
});
step('revoked codes cannot be redeemed or revoked twice', async () => {
  const rv = await call('POST', `/admin/codes/${codes[2].id}/revoke`, null, 201);
  assert.equal(rv.status, 'REVOKED');
  await call('POST', `/admin/codes/${codes[2].id}/revoke`, null, 400);
  await as(otherToken, 'POST', '/subscription/redeem', { code: codes[2].code }, 400);
});
step('admin sees who redeemed, customers, payments and totals', async () => {
  const redeemed = await call('GET', '/admin/codes?status=REDEEMED', null, 200);
  const mine = redeemed.filter((c) => codes.some((x) => x.id === c.id));
  assert.equal(mine.length, 2);
  assert.equal(mine[0].redeemedBy.email, `x-${email}`);
  const customers = await call('GET', '/admin/customers?search=' + encodeURIComponent('x-' + email), null, 200);
  assert.equal(customers.length, 1);
  assert.equal(customers[0].plan, 'PROFESSIONAL');
  assert.equal(customers[0].totalPaid, 99800);
  const payments = await call('GET', '/admin/payments', null, 200);
  assert.ok(payments.filter((p) => p.customer.email === `x-${email}`).length === 2);
  const o = await call('GET', '/admin/overview', null, 200);
  assert.ok(o.activeProfessional >= 1 && o.revenueTotal >= 99800);
});


// ---- Phase 5: licenses ---------------------------------------------------------------
step('store license: stable key, activation returns a token the POS can verify', async () => {
  const { verify, createPublicKey, randomUUID } = require('node:crypto');
  const pubSrc = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../pos/server/license-public-key.ts'), 'utf8');
  const pub = createPublicKey({ key: Buffer.from(pubSrc.match(/BUILT_IN = '([^']+)'/)[1], 'base64'), format: 'der', type: 'spki' });

  const lic = await call('GET', `/stores/${storeId}/license`, null, 200);
  assert.match(lic.licenseKey, /^POS-[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  assert.equal((await call('GET', `/stores/${storeId}/license`, null, 200)).licenseKey, lic.licenseKey);
  await as(otherToken, 'GET', `/stores/${storeId}/license`, null, 404);

  const installId = randomUUID();
  const loose = lic.licenseKey.toLowerCase().replace(/-/g, ' ');
  const r = await as('', 'POST', '/licenses/activate', { licenseKey: loose, installId, deviceName: 'Smoke PC', appVersion: '0.1.0' }, 200);
  const [body, sig] = r.token.split('.');
  assert.ok(verify(null, Buffer.from(body), pub, Buffer.from(sig, 'base64url')), 'signature verifies with the POS public key');
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  assert.equal(p.iid, installId);
  assert.equal(p.sid, storeId);
  assert.equal(p.plan, 'PROFESSIONAL', 'owner has Professional at this point');
  assert.ok(p.exp * 1000 > Date.now() + 25 * 86400000);
  assert.equal(r.store.name, 'Renamed Store');

  await as('', 'POST', '/licenses/activate', { licenseKey: 'POS-AAAA-AAAA-AAAA', installId }, 404);
  await as('', 'POST', '/licenses/activate', { licenseKey: lic.licenseKey, installId: 'not-a-uuid' }, 400);
  const after = await call('GET', `/stores/${storeId}/license`, null, 200);
  assert.equal(after.activations.length, 1);
  assert.equal(after.activations[0].deviceName, 'Smoke PC');

  const replaced = await call('POST', `/stores/${storeId}/license/regenerate`, null, 201);
  assert.notEqual(replaced.licenseKey, lic.licenseKey);
  const old = await as('', 'POST', '/licenses/activate', { licenseKey: lic.licenseKey, installId }, 403);
  assert.match(old.message, /replaced/);
  await as('', 'POST', '/licenses/activate', { licenseKey: replaced.licenseKey, installId }, 200);
});


// ---- POS account link (no license key) ----------------------------------------------
step('POS link: website code -> POS device; subscribe and cancel from the POS', async () => {
  const { randomUUID } = require('node:crypto');
  const installId = randomUUID();
  const other = await as(otherToken, 'GET', '/auth/me', null, 200);
  assert.equal(other.plan, 'PROFESSIONAL', 'x- user has Pro from the redeemed codes');

  // Use a fresh Free account so subscribe/cancel are visible.
  const fresh = await as('', 'POST', '/auth/register', { email: `p-${email}`, password, fullName: 'Pos Link' }, 201);
  const link = await as(fresh.accessToken, 'POST', '/pos/link-code', null, 201);
  assert.ok(link.code && Date.parse(link.expiresAt) > Date.now());

  // Link codes are not website sessions.
  await as(link.code, 'GET', '/auth/me', null, 401);

  const c = await as('', 'POST', '/pos/connect', { linkCode: link.code, installId, deviceName: 'Shop PC', appVersion: '0.1.0' }, 200);
  assert.equal(c.plan, 'FREE');
  assert.equal(c.account.email, `p-${email}`);
  assert.equal(c.store.name, "Pos's Store", 'store was auto-created at registration');
  assert.deepEqual(c.branches.map((b) => b.code), ['MAIN']);
  assert.ok(c.deviceToken && c.priceMonthly === 49900);

  // Device tokens are not website sessions either, and only work for their install.
  await as(c.deviceToken, 'GET', '/auth/me', null, 401);
  await as(c.deviceToken, 'POST', '/pos/refresh', { installId: randomUUID() }, 401);
  await as('', 'POST', '/pos/connect', { linkCode: 'garbage', installId }, 401);

  const sub = await as(c.deviceToken, 'POST', '/pos/subscribe', { installId }, 200);
  assert.equal(sub.plan, 'PROFESSIONAL');
  const days = (Date.parse(sub.professionalUntil) - Date.now()) / 86400000;
  assert.ok(days > 27 && days < 32, 'one month: ' + days);
  const pays = await call('GET', '/admin/payments', null, 200);
  const mine = pays.filter((p) => p.customer.email === `p-${email}`);
  assert.equal(mine.length, 1);
  assert.match(mine[0].description, /subscribed in POS/);

  const again = await as(c.deviceToken, 'POST', '/pos/subscribe', { installId }, 200);
  assert.ok(Date.parse(again.professionalUntil) > Date.parse(sub.professionalUntil), 'second click adds a month');

  const cancel = await as(c.deviceToken, 'POST', '/pos/cancel', { installId }, 200);
  assert.equal(cancel.plan, 'FREE');
  const refreshed = await as(c.deviceToken, 'POST', '/pos/refresh', { installId }, 200);
  assert.equal(refreshed.plan, 'FREE');
});

step('delete store', () => call('DELETE', `/stores/${storeId}`, null, 204));

(async () => {
  let failed = 0;
  for (const [name, fn] of steps) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (e) {
      failed++;
      console.log(`not ok - ${name}\n    ${e.message}`);
    }
  }
  const prisma = new PrismaClient();
  await prisma.upgradeCode.deleteMany({ where: { createdBy: { email: { in: [email, `x-${email}`, `p-${email}`] } } } });
  const { count } = await prisma.user.deleteMany({ where: { email: { in: [email, `x-${email}`, `p-${email}`] } } });
  await prisma.$disconnect();
  console.log(`\ncleanup: removed ${count} test user(s)`);
  console.log(failed ? `${failed} FAILED` : `all ${steps.length} passed`);
  process.exit(failed ? 1 : 0);
})();
