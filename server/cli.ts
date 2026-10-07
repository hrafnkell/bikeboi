// Maintenance from a shell on the server:
//   bun server/cli.ts users
//   bun server/cli.ts reset-password <email>   (new password from the prompt, or NEW_PASSWORD env)
//   bun server/cli.ts delete-user <email>

import { findUserByEmail, hashPassword, revokeAll } from './auth.ts';
import { openDb } from './db.ts';

const [command, emailArg] = process.argv.slice(2);
const db = openDb(process.env.DB_PATH ?? 'data/bikeboi.db');

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function needEmail(): string {
  if (!emailArg) fail('usage: bun server/cli.ts <command> <email>');
  return emailArg.trim().toLowerCase();
}

switch (command) {
  case 'users': {
    const rows = db
      .query(
        `SELECT u.id, u.email, u.created_at AS createdAt, (SELECT count(*) FROM rides r WHERE r.user_id = u.id) AS rides
         FROM users u ORDER BY u.id`,
      )
      .all() as Array<{ id: number; email: string; createdAt: number; rides: number }>;
    for (const r of rows) console.log(`${r.id}\t${r.email}\t${new Date(r.createdAt).toISOString().slice(0, 10)}\t${r.rides} rides`);
    console.log(`${rows.length} user${rows.length === 1 ? '' : 's'}`);
    break;
  }
  case 'reset-password': {
    const email = needEmail();
    const user = findUserByEmail(db, email);
    if (!user) fail('no such user');
    let password = process.env.NEW_PASSWORD ?? '';
    if (!password) {
      const first = prompt('New password:') ?? '';
      const second = prompt('Again:') ?? '';
      if (first !== second) fail('passwords do not match');
      password = first;
    }
    if (password.length < 8 || password.length > 200) fail('use 8 to 200 characters');
    db.query('UPDATE users SET password_hash = $h WHERE id = $id').run({ h: await hashPassword(password), id: user.id });
    revokeAll(db, user.id);
    console.log(`password reset for user ${user.id}; all sessions signed out`);
    break;
  }
  case 'delete-user': {
    const email = needEmail();
    const user = findUserByEmail(db, email);
    if (!user) fail('no such user');
    db.query('DELETE FROM users WHERE id = $id').run({ id: user.id });
    console.log(`user ${user.id} deleted`);
    break;
  }
  default:
    fail('usage: bun server/cli.ts users | reset-password <email> | delete-user <email>');
}
