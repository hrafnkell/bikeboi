// SQLite via bun:sqlite: one file, WAL mode, migrations run at startup.

import { Database } from 'bun:sqlite';
import { MIGRATIONS } from './migrations.ts';

export function openDb(path: string = process.env.DB_PATH ?? ':memory:'): Database {
  const db = new Database(path, { strict: true, create: true });
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

/** Applies every migration newer than the database's user_version. Returns the version now. */
export function migrate(db: Database): number {
  const current = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
  const pending = MIGRATIONS.filter((m) => m.id > current).sort((a, b) => a.id - b.id);
  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.id}`);
    })();
  }
  return pending.length ? pending[pending.length - 1].id : current;
}
