import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { LocalDbStatus } from '@pos/shared-types';
import { MIGRATIONS } from './migrations';

export type Db = Database.Database;

/**
 * Opens (or creates) the local POS database and brings it to the latest schema.
 * Deliberately free of Electron imports so it can be exercised by the self-test.
 */
export function openDatabase(filePath: string): Db {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL'); // safe concurrent reads, fewer fsyncs
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  ensureDefaults(db);
  return db;
}

/** Applies pending migrations, each in its own transaction, tracked by PRAGMA user_version. */
export function migrate(db: Db): number {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.pragma(`user_version = ${m.version}`);
    })();
  }
  return db.pragma('user_version', { simple: true }) as number;
}

/** First-run rows: install id, a default store + branch, the license cache row (FREE). */
function ensureDefaults(db: Db) {
  db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('install_id', ?)`).run(randomUUID());
    db.prepare(`INSERT OR IGNORE INTO license_cache (id, plan) VALUES (1, 'FREE')`).run();

    const hasStore = db.prepare(`SELECT 1 FROM stores LIMIT 1`).get();
    if (!hasStore) {
      const storeId = randomUUID();
      db.prepare(`INSERT INTO stores (id, name) VALUES (?, 'My Store')`).run(storeId);
      db.prepare(
        `INSERT INTO branches (id, store_id, name, code, is_current) VALUES (?, ?, 'Main', 'MAIN', 1)`,
      ).run(randomUUID(), storeId);
    }
  })();
}

export function getStatus(db: Db): LocalDbStatus {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as { name: string }[];
  return {
    path: db.name,
    schemaVersion: db.pragma('user_version', { simple: true }) as number,
    tables: tables.map((t) => t.name),
  };
}
