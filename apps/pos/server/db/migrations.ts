/**
 * Local POS schema (SQLite). All operational business data lives here, never in the cloud.
 *
 * Conventions (chosen so a future sync layer can be added without a rewrite):
 *  - TEXT UUID primary keys (no autoincrement collisions across branches)
 *  - money stored as INTEGER minor units (centavos); rates as basis points (1200 = 12%)
 *  - created_at / updated_at as ISO-8601 UTC text; soft delete via deleted_at on master data
 *  - operational rows carry branch_id
 *
 * Migrations are append-only. Never edit a released migration; add a new one.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
CREATE TABLE stores (
  id              TEXT PRIMARY KEY,
  remote_store_id TEXT,                       -- PostgreSQL stores.id once licensed
  name            TEXT NOT NULL,
  address         TEXT,
  phone           TEXT,
  currency        TEXT NOT NULL DEFAULT 'PHP',
  timezone        TEXT NOT NULL DEFAULT 'Asia/Manila',
  receipt_header  TEXT,
  receipt_footer  TEXT,
  created_at      TEXT NOT NULL DEFAULT ${NOW},
  updated_at      TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE branches (
  id               TEXT PRIMARY KEY,
  store_id         TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  remote_branch_id TEXT,
  name             TEXT NOT NULL,
  code             TEXT NOT NULL,
  address          TEXT,
  is_current       INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1)), -- this install's branch
  created_at       TEXT NOT NULL DEFAULT ${NOW},
  updated_at       TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (store_id, code)
);

-- Local POS login accounts (owner / manager / cashier). Not the SaaS account.
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  branch_id     TEXT REFERENCES branches(id) ON DELETE SET NULL,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT,
  pin_hash      TEXT,
  role          TEXT NOT NULL DEFAULT 'cashier' CHECK (role IN ('owner','manager','cashier')),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT ${NOW},
  updated_at    TEXT NOT NULL DEFAULT ${NOW}
);

-- Professional: employee management (HR info, linked to a login when they use the POS).
CREATE TABLE employees (
  id          TEXT PRIMARY KEY,
  user_id     TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  branch_id   TEXT REFERENCES branches(id) ON DELETE SET NULL,
  full_name   TEXT NOT NULL,
  position    TEXT,
  phone       TEXT,
  email       TEXT,
  hourly_rate INTEGER,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT ${NOW},
  updated_at  TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW},
  deleted_at TEXT
);

CREATE TABLE taxes (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  rate_bps     INTEGER NOT NULL CHECK (rate_bps >= 0),
  is_inclusive INTEGER NOT NULL DEFAULT 1 CHECK (is_inclusive IN (0,1)),
  is_default   INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at   TEXT NOT NULL DEFAULT ${NOW},
  updated_at   TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE products (
  id                  TEXT PRIMARY KEY,
  category_id         TEXT REFERENCES categories(id) ON DELETE SET NULL,
  tax_id              TEXT REFERENCES taxes(id) ON DELETE SET NULL,
  sku                 TEXT UNIQUE,
  barcode             TEXT UNIQUE,
  name                TEXT NOT NULL,
  description         TEXT,
  unit                TEXT NOT NULL DEFAULT 'pc',
  purchase_price      INTEGER NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  selling_price       INTEGER NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
  track_stock         INTEGER NOT NULL DEFAULT 1 CHECK (track_stock IN (0,1)),
  low_stock_threshold REAL,
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at          TEXT NOT NULL DEFAULT ${NOW},
  updated_at          TEXT NOT NULL DEFAULT ${NOW},
  deleted_at          TEXT
);
CREATE INDEX idx_products_name ON products(name);
CREATE INDEX idx_products_category ON products(category_id);

-- Current stock per product per branch. History lives in inventory_movements.
CREATE TABLE inventory (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  branch_id  TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  quantity   REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (product_id, branch_id)
);

CREATE TABLE inventory_movements (
  id             TEXT PRIMARY KEY,
  product_id     TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  branch_id      TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  quantity_delta REAL NOT NULL,
  quantity_after REAL NOT NULL,
  reason         TEXT NOT NULL CHECK (reason IN ('sale','void','refund','adjustment','receive','count','transfer_in','transfer_out')),
  reference_type TEXT,
  reference_id   TEXT,
  note           TEXT,
  user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX idx_inv_mov_product_time ON inventory_movements(product_id, created_at);
CREATE INDEX idx_inv_mov_branch_time ON inventory_movements(branch_id, created_at);

CREATE TABLE customers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW},
  deleted_at TEXT
);
CREATE INDEX idx_customers_phone ON customers(phone);

CREATE TABLE suppliers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  contact_name TEXT,
  phone        TEXT,
  email        TEXT,
  address      TEXT,
  created_at   TEXT NOT NULL DEFAULT ${NOW},
  updated_at   TEXT NOT NULL DEFAULT ${NOW},
  deleted_at   TEXT
);

CREATE TABLE discounts (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('percent','fixed')),
  value      INTEGER NOT NULL CHECK (value >= 0), -- bps for percent, minor units for fixed
  scope      TEXT NOT NULL DEFAULT 'sale' CHECK (scope IN ('sale','item')),
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE cash_sessions (
  id            TEXT PRIMARY KEY,
  branch_id     TEXT NOT NULL REFERENCES branches(id),
  opened_by     TEXT NOT NULL REFERENCES users(id),
  closed_by     TEXT REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opening_cash  INTEGER NOT NULL DEFAULT 0,
  expected_cash INTEGER,
  counted_cash  INTEGER,
  note          TEXT,
  opened_at     TEXT NOT NULL DEFAULT ${NOW},
  closed_at     TEXT
);
CREATE INDEX idx_cash_sessions_status ON cash_sessions(branch_id, status);

CREATE TABLE sales (
  id              TEXT PRIMARY KEY,
  receipt_number  TEXT NOT NULL UNIQUE,
  branch_id       TEXT NOT NULL REFERENCES branches(id),
  cash_session_id TEXT REFERENCES cash_sessions(id),
  user_id         TEXT REFERENCES users(id),
  customer_id     TEXT REFERENCES customers(id),
  discount_id     TEXT REFERENCES discounts(id),
  status          TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','voided','refunded')),
  subtotal        INTEGER NOT NULL,
  discount_total  INTEGER NOT NULL DEFAULT 0,
  tax_total       INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL,
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT ${NOW},
  updated_at      TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX idx_sales_branch_time ON sales(branch_id, created_at);
CREATE INDEX idx_sales_time ON sales(created_at);
CREATE INDEX idx_sales_user ON sales(user_id, created_at);

CREATE TABLE sale_items (
  id              TEXT PRIMARY KEY,
  sale_id         TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id      TEXT REFERENCES products(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,   -- snapshot at time of sale
  sku             TEXT,
  quantity        REAL NOT NULL CHECK (quantity > 0),
  unit_price      INTEGER NOT NULL,
  unit_cost       INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  tax_amount      INTEGER NOT NULL DEFAULT 0,
  line_total      INTEGER NOT NULL
);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_sale_items_product ON sale_items(product_id);

CREATE TABLE payments (
  id         TEXT PRIMARY KEY,
  sale_id    TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method     TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','card','ewallet','other')),
  amount     INTEGER NOT NULL,
  tendered   INTEGER,
  change_due INTEGER NOT NULL DEFAULT 0,
  reference  TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX idx_payments_sale ON payments(sale_id);

CREATE TABLE receipts (
  id              TEXT PRIMARY KEY,
  sale_id         TEXT NOT NULL UNIQUE REFERENCES sales(id) ON DELETE CASCADE,
  receipt_number  TEXT NOT NULL,
  content         TEXT NOT NULL,  -- rendered receipt (JSON) for reprints
  print_count     INTEGER NOT NULL DEFAULT 0,
  last_printed_at TEXT,
  created_at      TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);

-- Single-row cache of the last verified license so Pro features survive offline periods.
CREATE TABLE license_cache (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  license_key      TEXT,
  token            TEXT,          -- signed token from the API
  plan             TEXT NOT NULL DEFAULT 'FREE' CHECK (plan IN ('FREE','PROFESSIONAL')),
  remote_store_id  TEXT,
  expires_at       TEXT,
  last_verified_at TEXT,
  updated_at       TEXT NOT NULL DEFAULT ${NOW}
);
`,
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
