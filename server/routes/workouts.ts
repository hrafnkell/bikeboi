// The rider's own workouts, keyed by the ids the app generates.

import { ApiError, json, readJson } from '../http.ts';
import * as v from '../validate.ts';
import { requireUser } from './auth.ts';
import type { AuthContext } from './auth.ts';

interface WorkoutRow {
  id: string;
  name: string;
  text: string;
  updatedAt: number;
}

type RouteRequest = Request & { params?: Record<string, string> };

function paramId(req: Request): string {
  return v.workoutId((req as RouteRequest).params?.id);
}

export function workoutsRoutes(ctx: AuthContext) {
  const one = ctx.db.query('SELECT id, name, text, updated_at AS updatedAt FROM workouts WHERE user_id = $u AND id = $id');

  return {
    list(req: Request): Response {
      const user = requireUser(ctx, req);
      const workouts = ctx.db
        .query('SELECT id, name, text, updated_at AS updatedAt FROM workouts WHERE user_id = $u ORDER BY updated_at, id')
        .all({ u: user.id }) as WorkoutRow[];
      return json({ workouts });
    },

    async put(req: Request): Promise<Response> {
      const user = requireUser(ctx, req);
      const id = paramId(req);
      const body = v.object(await readJson(req, 16 * 1024));
      const name = v.workoutName(body.name);
      const text = v.workoutText(body.text);
      const updatedAt = v.timestamp(body.updatedAt);

      const existing = one.get({ u: user.id, id }) as WorkoutRow | null;
      if (existing && existing.updatedAt > updatedAt) return json({ workout: existing, applied: false });
      if (!existing) {
        const { n } = ctx.db.query('SELECT count(*) AS n FROM workouts WHERE user_id = $u').get({ u: user.id }) as { n: number };
        if (n >= v.MAX_WORKOUTS) throw new ApiError(413, 'workout limit reached');
      }
      ctx.db
        .query(
          `INSERT INTO workouts (user_id, id, name, text, updated_at) VALUES ($u, $id, $name, $text, $t)
           ON CONFLICT(user_id, id) DO UPDATE SET name = excluded.name, text = excluded.text, updated_at = excluded.updated_at`,
        )
        .run({ u: user.id, id, name, text, t: updatedAt });
      return json({ workout: one.get({ u: user.id, id }), applied: true }, existing ? 200 : 201);
    },

    remove(req: Request): Response {
      const user = requireUser(ctx, req);
      const id = paramId(req);
      ctx.db.query('DELETE FROM workouts WHERE user_id = $u AND id = $id').run({ u: user.id, id });
      return json({ ok: true });
    },
  };
}
