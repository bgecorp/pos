# SaaS POS — Architecture (MVP)

## 1. Architecture

```
            ┌──────────────────────────── Cloud (SaaS) ────────────────────────────┐
 Browser ──►│ apps/website (React+Vite+Tailwind) ──HTTP/JSON──► apps/api (NestJS)  │
            │                                                     │ Prisma         │
            │                                                     ▼                │
            │                                   PostgreSQL (Supabase-hosted)       │
            │                 users · stores · branches · plans · subscriptions   │
            │                 payments · licenses · license_activations           │
            └──────────────────────────────────────────▲──────────────────────────┘
                                                       │ HTTPS, only for login /
                                                       │ license activation & refresh
            ┌──────────── Shop PC (offline-first) ─────┴──────────────────────────┐
            │ apps/pos                                                           │
            │  any browser ──http://localhost:4100──► local Node server          │
            │  (web/: React POS screens)   POST /rpc/<op>   (server/, 127.0.0.1)  │
            │                                               └─► better-sqlite3   │
            │                                                   pos.sqlite       │
            │  products · inventory · sales · receipts · reports · license_cache │
            └────────────────────────────────────────────────────────────────────┘
```

The POS is **browser-based for now** (owner's decision, 2026-11-10). A small Node server runs on the
shop PC, keeps all POS data in SQLite, and serves the POS screens. An Electron desktop shell can be added
later: it would register the same handler map (`server/handlers.ts`) as IPC channels.

Key decisions:

| Decision | Why |
|---|---|
| npm workspaces monorepo (no Turborepo/Nx/pnpm) | Zero extra tooling; Node 22 ships npm. |
| Payments are **generated codes** for the MVP (no PayMongo/Xendit yet) | Owner's decision. A provider can be added later behind the same `payments` module. |
| Supabase used **only as hosted PostgreSQL** via Prisma | No local Postgres/Docker needed. Auth stays in NestJS (JWT) per spec, so we can move to any Postgres later by changing `DATABASE_URL`. |
| Connect through Supabase's **session pooler** (port 5432) | The direct host is IPv6-only. The transaction pooler added about 1.2 s per query with Prisma; the session pooler takes about 0.3 s (the round trip to Sydney). |
| POS = local Node server (`node:http`, no framework) + `better-sqlite3` | Synchronous, fast, real transactions, no internet needed. The browser never sees SQL: it calls about 30 named operations (`POST /rpc/<op>`), and each one validates its input. |
| Local server listens on 127.0.0.1 only and requires `X-POS-Client: 1` plus a same-origin `Origin` | Other machines can't reach it. Other websites open in the same browser can't drive the till, because the custom header forces a CORS preflight that is never approved. |
| Shared packages consumed from source by Vite, from `dist` by Node | The website and POS screens need no build step for packages; the API and POS server use compiled CommonJS. |
| Money as integer minor units, UUID keys, `updated_at`, soft delete | Avoids float rounding. Rows from different branches can merge later without ID collisions (sync-ready). |
| Pinned majors: Nest 11, Prisma 6, Vite 6, TS 5.9 | Proven, well-documented releases. Newer majors (Prisma 7+, TS 7) bring breaking changes that the MVP doesn't need. |

## 2. Database schemas

- **PostgreSQL (SaaS):** [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma)
  `users`, `stores`, `branches`, `plans`, `subscriptions`, `payments`, `licenses`, `license_activations`.
  No sales, product or inventory data.
- **SQLite (POS):** [`apps/pos/server/db/migrations.ts`](../apps/pos/server/db/migrations.ts)
  `stores`, `branches`, `users`, `employees`, `products`, `categories`, `inventory`, `inventory_movements`,
  `customers`, `suppliers`, `sales`, `sale_items`, `payments`, `discounts`, `taxes`, `receipts`,
  `cash_sessions`, `settings`, `license_cache`.
  Versioned with `PRAGMA user_version`, WAL mode, foreign keys on, each migration in a transaction.

## 3. Folder structure

```
POS/
├── apps/
│   ├── api/          NestJS: src/{health,prisma,…modules}, prisma/schema.prisma
│   ├── website/      React+Vite+Tailwind: src/{pages,components,lib}
│   └── pos/
│       ├── server/   local Node server: index.ts (HTTP), handlers.ts (operation map),
│       │             db/ (SQLite + migrations), services/ (catalog, inventory, sales,
│       │             receipt, reports, settings), selftest.ts
│       ├── shared/   types + cart pricing used by both server and screens
│       └── web/      React POS screens (Sell, Products, Inventory, Sales, Reports, Settings)
├── packages/
│   ├── shared-types/          types shared by all apps
│   └── feature-entitlements/  plan → feature matrix + hasFeature()
└── docs/
```

## 4. Website modules (API module → pages)

| API module | Website pages | Phase |
|---|---|---|
| `health` | System status | 1 ✅ |
| `auth` (register/login/JWT guard) | Register, Login, Logout | 2 ✅ |
| `auth` → account endpoints | Account settings | 2 ✅ |
| `stores` (+ branches) | Dashboard, Stores, Store detail | 2 ✅ |
| `plans` (+ `effectivePlan()`) | Landing, Pricing | 2 ✅ |
| `subscriptions`: redeem upgrade code, plan + payment history | Subscription page (plan, redeem, payment history) | 4 ✅ |
| `admin` (owner only): overview, customers, payments, upgrade codes | Admin page | 4 ✅ |
| `licenses` (issue/activate/refresh) | Store page: license key; POS download page | 5 |

### API endpoints (Phase 2)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/health` | – | API + DB status |
| GET | `/api/plans` | – | pricing catalogue with features and limits |
| POST | `/api/auth/register` | – | `{email, password, fullName}` → `{accessToken, user}`; 10/min/IP |
| POST | `/api/auth/login` | – | `{email, password}` → `{accessToken, user}`; 10/min/IP |
| GET | `/api/auth/me` | JWT | user + effective plan + features |
| PATCH | `/api/account` | JWT | `{fullName}` |
| POST | `/api/account/password` | JWT | `{currentPassword, newPassword}` |
| GET / POST | `/api/stores` | JWT | Free: 1 store. New stores get a `MAIN` branch |
| GET / PATCH / DELETE | `/api/stores/:id` | JWT | owner only (404 otherwise) |
| POST | `/api/stores/:id/branches` | JWT | more than one branch requires `multi_branch` (Pro) |
| DELETE | `/api/stores/:id/branches/:branchId` | JWT | last branch can't be removed |

### API endpoints (Phase 4)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/subscription` | JWT | current plan, Professional end date, periods, payments |
| POST | `/api/subscription/redeem` | JWT | `{code}`: accepts `pro-7kq2 m9xd` style input; 5/min/IP |
| GET | `/api/admin/overview` | Admin | customers, active Professional, revenue (30 days, all time), unused codes |
| GET | `/api/admin/customers?search=` | Admin | every account with plan, end date, stores, total paid |
| GET | `/api/admin/payments` | Admin | every payment with the customer |
| GET / POST | `/api/admin/codes` | Admin | list (`?status=UNUSED/REDEEMED/REVOKED`) / generate `{count ≤ 50, months ≤ 24, note}` |
| POST | `/api/admin/codes/:id/revoke` | Admin | unused codes only |

**How upgrades work (MVP, no payment gateway):** the owner generates codes on the Admin page (format `PRO-XXXX-XXXX`, with no 0/O/1/I/L so they're easy to read aloud). The owner sells a code to a customer, who pays by GCash, bank or cash outside the system. The customer redeems it on their Subscription page. Redeeming runs in one transaction: it marks the code used (a conditional update, so it can't be redeemed twice), starts Professional or adds months to the current period, and records a `PAID` payment (plan price × months, `provider = "code"`).

**Admin role:** `users.role = ADMIN`. It's set with `npm run admin:promote -w @pos/api -- <email>` (add `--remove` to undo). `AdminGuard` checks the role in the database on every request, so a demotion takes effect immediately.

Auth details: passwords are hashed with Node's built-in scrypt (no native dependency). JWTs are HS256, 7 days (`JWT_EXPIRES_IN`), stored in `localStorage` by the website. Logout clears the token on the client.
Plan status is decided only in `PlansService.effectivePlan()`: an ACTIVE, unexpired PROFESSIONAL subscription means PROFESSIONAL, otherwise FREE.

## 5. POS modules (server services in `apps/pos/server/services`, exposed via `handlers.ts`)

| Module | Responsibilities | Phase |
|---|---|---|
| `db` | open, migrate, defaults, status | 1 ✅ |
| `catalog` | products and categories: CRUD, barcode/SKU lookup, search, soft delete | 3 ✅ |
| `inventory` | stock levels, receive/remove/count adjustments, movement history, low-stock count | 3 ✅ |
| `sales` | cart totals (`shared/pricing.ts`), sale discounts, VAT incl./excl., cash/card/e-wallet, change, one transaction per sale, void with stock restore | 3 ✅ |
| `receipt` | HTML receipt (58/80 mm) snapshot per sale, preview, browser print, reprint count | 3 ✅ |
| `reports` | summary, daily sales, product sales with profit (Free: last 90 days) | 3 ✅ |
| `settings` | store and receipt details, checkout preferences, taxes, discount presets | 3 ✅ |
| `cash-sessions` | open and close shift, expected vs counted cash | later |
| `staff` (Pro) | staff in the `users` table: name, role, scrypt-hashed 4–6 digit PIN; tap name + PIN to switch cashier; `sales.user_id` records who sold | Pro ✅ |
| `analytics` (Pro) | advanced report (by cashier, hour, weekday, payment, category); inventory analytics (stock value at cost/retail, days left at 30-day pace, slow movers); rule-based insights | Pro ✅ |
| `license` → branches (Pro) | activation returns the store's website branches; the POS links to MAIN, and you can switch (new receipts use the branch code) | Pro ✅ |
| `license` | activate with key or login, cache token, compute effective plan offline | 5 |

Selling below zero stock is allowed (common in small shops); the cashier sees a warning.
Prices are integer centavos; a sale discount is spread across lines so tax is computed on what was actually charged.

## 6. Free vs Professional

Source of truth: [`packages/feature-entitlements/src/index.ts`](../packages/feature-entitlements/src/index.ts).

| Feature | Free | Pro |
|---|:-:|:-:|
| Unlimited products, basic inventory, barcode scanning | ✓ | ✓ |
| Receipt printing, cashier interface, offline mode | ✓ | ✓ |
| Basic sales reports (daily, summary, product sales) | ✓ | ✓ |
| Stores per account | 1 | unlimited |
| Sales history visible in reports | 90 days | unlimited |
| Employee management | — | ✓ |
| Advanced inventory (suppliers, receiving, counts) | — | ✓ |
| Multiple branches | — | ✓ |
| Advanced reports, sales analytics, AI insights | — | ✓ |

Sales are **never deleted** under Free. The 90-day limit only affects what the reports show.

What each Professional feature does in the POS:

| Feature | Where | Implementation |
|---|---|---|
| Unlimited sales history | Sales, Reports | `clampHistory` removes the 90-day window |
| Employee management | Staff page; cashier chip on Sell | `services/staff.ts` |
| Advanced reports, sales analytics | Reports → Advanced | `analytics.advancedReport` |
| Advanced inventory | Reports → Inventory | `analytics.inventoryAnalytics` |
| Multiple branches | Website: add branches. POS: Settings → License → "This computer is branch" | `license.branchOptions/selectBranch` |
| Business insights | Reports → Insights | `analytics.insights`: **rule-based, runs offline**, no sales data leaves the PC. An LLM could rephrase or extend these later, but only with internet and the owner's consent. |

Gating is enforced twice: the screens show a locked card (`ProOnly`), and every Pro operation calls `requireFeature()` on the POS server, which uses the signature-verified license. After a downgrade, Pro screens lock again, and staff and sales data are kept.

## 7. Sign-in, subscription and license (current flow, 2026-11-10)

The owner decided: **no dashboard and no license key.** The website only handles landing, pricing, register/login, and the owner's Admin page. Everything else happens in the POS.

1. **Register:** the API creates the user plus their store ("Ana's Store") with a MAIN branch and a license, in one step.
2. **Register or log in → straight into the POS:** the website calls `POST /api/pos/link-code` (JWT) to get a 5-minute one-time code. It then opens `VITE_POS_URL/#link=<code>`; URL fragments are never sent to any server. Admins go to `/admin` instead.
3. **The POS signs itself in:** its screen sees `#link=`, removes it from the address bar, and calls `account:connect`. The POS server calls `POST /api/pos/connect {linkCode, installId, deviceName}` and gets back:
   - a **device token** (JWT, 365 days, purpose `pos-device`, bound to the `installId`)
   - the signed license token, the store and its branches, the account email, and the price.
4. **Subscription page in the POS:**
   - **Subscribe** calls `POST /api/pos/subscribe` with the device token. It starts or extends Professional by 1 month **immediately, with no payment step (test mode)**, and records a PAID `isTestMode` payment with provider `pos-instant`, which shows in the Admin page.
   - **Cancel** calls `POST /api/pos/cancel`, which marks subscriptions CANCELED, so the next token says FREE.
5. **Refresh:** `POST /api/pos/refresh` with the device token, on startup, every 6 h, and via Check now. A 401 signs the POS out (Free); selling continues.
6. **Token safety:** link codes and device tokens are signed with `JWT_SECRET` but carry a `purpose`, and `JwtAuthGuard` rejects them as website sessions.
7. **Before charging real money:** put a payment step (PayMongo/Xendit or a code) inside `PosService.subscribe` before the subscription is created.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/pos/link-code` | JWT (website) | 5-minute code |
| POST | `/api/pos/connect` | link code | → device token + license; 20/min/IP |
| POST | `/api/pos/refresh` | device token | new license token |
| POST | `/api/pos/subscribe` | device token | instant Professional (+1 month); 10/min |
| POST | `/api/pos/cancel` | device token | ends Professional |

The original license-key flow below (Phase 5) still works on the server, but it's no longer shown anywhere in the UI.

### Phase 5 license details (signing, offline, branches)

Built in Phase 5 ✅.

1. The customer registers on the website and creates a store. The API creates a `licenses` row with a key like `POS-6PR7-DPHP-T4GH`, shown on the store page with Copy and Replace buttons. Stores made before Phase 5 get a key the first time the page is opened.
2. The customer runs the POS. On first run it generates a random `install_id` (no hardware fingerprint).
3. In POS **Settings → License** they paste the key. The POS server calls `POST /api/licenses/activate {licenseKey, installId, deviceName, appVersion}` (needs internet once; 20/min/IP).
4. The API checks that the key is ACTIVE and what plan the store owner has. It upserts `license_activations` (shown on the store page as "Activated computers") and returns a **token signed with Ed25519**:
   `base64url(payload).base64url(signature)`, with payload = `LicenseTokenPayload {lid, sid, uid, iid, plan, iat, exp}`.
   `exp` = the sooner of `LICENSE_TOKEN_DAYS` (30) or the end of the owner's Professional period.
5. The POS checks the signature with the **public key** built into `apps/pos/server/license-public-key.ts`. It then saves the token in `license_cache` and links `stores.remote_store_id`. If the local store is still named "My Store", it takes the website's store name.
6. **Effective plan:** every time the POS needs the plan, it re-verifies the token's signature, `iid` (this computer) and `exp`. A valid, unexpired PROFESSIONAL token means PROFESSIONAL; anything else means FREE. Editing `license_cache`, copying the token to another PC, or a forged signature all give FREE. Free features never check the network.
7. The POS refreshes 5 s after start and every 6 h, and there's a **Check now** button.
   - **Network failure:** it keeps the cached token until `exp` (offline grace) and shows the error.
   - **Key rejected (replaced or unknown, 403/404):** it drops to FREE.
   - **Disconnect** clears the license and leaves sales untouched.

Keys: `npm run license:keygen -w @pos/api` prints a new pair. `LICENSE_PRIVATE_KEY` goes in `apps/api/.env` (secret) and the public key in the POS file above. Generate a fresh pair before going to production. The development pair was created on 2026-11-10.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/stores/:id/license` | JWT (owner) | key, status, activated computers |
| POST | `/api/stores/:id/license/regenerate` | JWT (owner) | revoke old key, issue new |
| POST | `/api/licenses/activate` | key | returns signed token; also used for refresh |

## 8. Roadmap

| Phase | Scope | Done when |
|---|---|---|
| **1 Setup** ✅ | monorepo, shared packages, NestJS + Prisma, React + Tailwind, SQLite | builds pass, `/api/health` responds, SQLite self-test passes |
| **2 Website** ✅ | auth (scrypt + JWT), dashboard, stores + branches, pricing, account settings | register → login → create store via UI; `npm run test:smoke -w @pos/api` passes (18 checks) |
| **3 POS (browser)** ✅ | products, inventory, cashier, sales, receipts, basic reports; local server + SQLite | full offline sale with receipt and stock decrease; `npm test -w @pos/pos` passes (23 tests) |
| **4 Subscription** ✅ | admin role and page, generated upgrade codes instead of a real gateway, redeem, subscription and payment history | a valid code upgrades to PRO (and stacks months); used, revoked and invalid codes are rejected; `npm run test:smoke -w @pos/api` passes (25 checks) |
| **5 Licensing** ✅ | license keys per store, Ed25519-signed tokens, activate/refresh/disconnect, offline cache, activated-computer list | POS shows Professional after activation and stays Professional offline until the token expires; tampered tokens give FREE. POS tests: 30, API smoke: 26 |
| **Pro features** ✅ | staff + cashier PINs, advanced reports, inventory analytics, insights, branch selection | Free is refused on the server; numbers add up across breakdowns. POS tests: 38 |
| 6 Testing | end-to-end checklist for every flow above | all scenarios pass |
