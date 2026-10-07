import { describe, expect, test } from 'bun:test';
import { migrate, openDb } from '../../server/db.ts';
import { MIGRATIONS } from '../../server/migrations.ts';

describe('database', () => {
  test('migrations run once and record the version', () => {
    const db = openDb(':memory:');
    const version = () => (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
    expect(version()).toBe(MIGRATIONS[MIGRATIONS.length - 1].id);
    expect(migrate(db)).toBe(version());
    const tables = (db.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(['users', 'sessions', 'settings', 'bests', 'workouts', 'rides']));
  });

  test('foreign keys are on and deleting a user cascades', () => {
    const db = openDb(':memory:');
    expect((db.query('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
    db.query("INSERT INTO users (id, email, password_hash, created_at) VALUES (1, 'a@b.c', 'x', 0)").run();
    db.query('INSERT INTO sessions (user_id, token_hash, created_at, last_seen_at, expires_at) VALUES (1, $h, 0, 0, 9)').run({ h: new Uint8Array([1, 2, 3]) });
    db.query("INSERT INTO rides (id, user_id, started_at, circuit_id, circuit_name, filename, summary, fit, fit_bytes, created_at) VALUES ('r', 1, 1, 'c', 'C', 'c.fit', '{}', $f, 1, 0)").run({ f: new Uint8Array([1]) });
    db.query("INSERT INTO bests (user_id, circuit_id, segment_id, lap_time, trace, updated_at) VALUES (1, 'c', '', 1, '{}', 0)").run();
    db.query('DELETE FROM users WHERE id = 1').run();
    for (const table of ['sessions', 'rides', 'bests']) {
      expect((db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(0);
    }
  });

  test('the server never pulls in DOM code', async () => {
    expect(typeof document).toBe('undefined');
    const mod = await import('../../server/app.ts');
    expect(typeof mod.createApp).toBe('function');
  });
});
