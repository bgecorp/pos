# SaaS POS (MVP)

Offline-first point of sale with a SaaS website for accounts, subscriptions and licenses.
Architecture, schemas and roadmap: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

| App | Stack | Data |
|---|---|---|
| `apps/website` | React + Vite + Tailwind | — |
| `apps/api` | NestJS + Prisma | PostgreSQL (Supabase): accounts, stores, subscriptions, payments, licenses |
| `apps/pos` | Local Node server + better-sqlite3, React screens in the browser | SQLite on the shop PC: all POS data |

## Requirements

- Node.js 22+ (npm 10+)
- A PostgreSQL database. We use a Supabase project. No Docker.

## Setup

```bash
npm install
```

1. **API env:** copy `apps/api/.env.example` to `apps/api/.env`. Fill in your **database password**, and set
   `JWT_SECRET` to a long random string. Use the Supabase **Session pooler** host (Connect → Session pooler).
   For `LICENSE_PRIVATE_KEY`, run `npm run license:keygen -w @pos/api`. Put the private key in `.env` and the public key in
   `apps/pos/server/license-public-key.ts`.
2. **Create tables:** run these from `apps/api`:
   ```bash
   npx prisma migrate dev --name init
   npm run db:seed
   ```
3. **Website env (optional):** copy `apps/website/.env.example` to `apps/website/.env.local`.
4. **Admin (owner) account:** register on the website, then run:
   ```bash
   npm run admin:promote -w @pos/api -- you@example.com
   ```
   Log out and in again; an **Admin** link appears. From there you generate upgrade codes and see every customer, subscription and payment.

## Run

Website and API (each in its own terminal):

```bash
npm run dev:api        # http://localhost:3000/api/health
npm run dev:website    # http://localhost:5173
```

POS on the shop PC (works with no internet):

```bash
npm run start:pos      # builds, then serves the POS at http://localhost:4100
```

For POS development with hot reload, run `npm run dev:pos` (server) and `npm run dev:pos-web` (screens at http://localhost:5174).

## Tests / checks

```bash
npm run typecheck
npm test -w @pos/feature-entitlements
npm test -w @pos/pos                 # POS services: pricing, sales, stock, receipts, reports (23 tests)
npm run test:smoke -w @pos/api       # API end-to-end incl. admin + upgrade codes (API must be running); cleans up after itself
```

## Notes

- POS data lives in `%APPDATA%\SaaS POS\pos.sqlite` on Windows. Set `POS_DATA_DIR` to use another folder (e.g. a test database), and `POS_PORT` to change the port.
- **Customer flow:** register or log in on the website and you're taken straight into the POS, already signed in. Subscribe to Professional on the POS **Subscription** page. It turns on instantly in test mode, with no payment step yet.
- `POS_API_URL` points the POS at the API (default `http://localhost:3000/api`). `VITE_POS_URL` (website) and `VITE_WEBSITE_URL` (POS) point the two at each other (defaults: `http://localhost:4100`, `http://localhost:5173`).
- The POS server only accepts connections from the same PC (127.0.0.1).
- Back up the POS by copying `pos.sqlite` while the POS server is stopped.
- Cashier shortcuts: **F2** search/scan, **F9** charge. USB barcode scanners work as keyboards: scan into the search box.
