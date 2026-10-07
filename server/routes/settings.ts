// The rider's settings document: one JSON blob per user, newest timestamp wins.

import { normalizeSettings } from '../../src/state.ts';
import { ApiError, json, readJson } from '../http.ts';
import * as v from '../validate.ts';
import { requireUser } from './auth.ts';
import type { AuthContext } from './auth.ts';

export function settingsRoutes(ctx: AuthContext) {
  return {
    get(req: Request): Response {
      const user = requireUser(ctx, req);
      const row = ctx.db.query('SELECT doc, updated_at AS updatedAt FROM settings WHERE user_id = $u').get({ u: user.id }) as
        | { doc: string; updatedAt: number }
        | null;
      return json(row ? { doc: JSON.parse(row.doc), updatedAt: row.updatedAt } : { doc: null, updatedAt: 0 });
    },

    async put(req: Request): Promise<Response> {
      const user = requireUser(ctx, req);
      const body = v.object(await readJson(req, v.MAX_SETTINGS_BYTES + 1024));
      const updatedAt = v.timestamp(body.updatedAt);
      const doc = normalizeSettings(body.doc);
      doc.updatedAt = updatedAt;
      const text = JSON.stringify(doc);
      if (text.length > v.MAX_SETTINGS_BYTES) throw new ApiError(413, 'settings too large');
      const result = ctx.db.query(
        `INSERT INTO settings (user_id, doc, updated_at) VALUES ($u, $doc, $t)
         ON CONFLICT(user_id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at
         WHERE excluded.updated_at > settings.updated_at`,
      ).run({ u: user.id, doc: text, t: updatedAt });
      const row = ctx.db.query('SELECT doc, updated_at AS updatedAt FROM settings WHERE user_id = $u').get({ u: user.id }) as {
        doc: string;
        updatedAt: number;
      };
      return json({ doc: JSON.parse(row.doc), updatedAt: row.updatedAt, applied: result.changes > 0 });
    },
  };
}
