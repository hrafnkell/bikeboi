// Best laps and segment bests: the faster time always wins, in both directions.

import { ApiError, json, readJson } from '../http.ts';
import * as v from '../validate.ts';
import { requireUser } from './auth.ts';
import type { AuthContext } from './auth.ts';

interface BestRow {
  circuitId: string;
  segmentId: string;
  trace: string;
  updatedAt: number;
}

function listBests(ctx: AuthContext, userId: number) {
  const rows = ctx.db
    .query('SELECT circuit_id AS circuitId, segment_id AS segmentId, trace, updated_at AS updatedAt FROM bests WHERE user_id = $u ORDER BY circuit_id, segment_id')
    .all({ u: userId }) as BestRow[];
  return rows.map((r) => ({ ...r, trace: JSON.parse(r.trace) }));
}

export function bestsRoutes(ctx: AuthContext) {
  const upsert = ctx.db.query(
    `INSERT INTO bests (user_id, circuit_id, segment_id, lap_time, trace, updated_at)
     VALUES ($u, $c, $s, $lap, $trace, $t)
     ON CONFLICT(user_id, circuit_id, segment_id) DO UPDATE SET
       lap_time = excluded.lap_time, trace = excluded.trace, updated_at = excluded.updated_at
     WHERE excluded.lap_time < bests.lap_time`,
  );
  const apply = ctx.db.transaction((userId: number, entries: Array<{ c: string; s: string; trace: ReturnType<typeof v.trace> }>, now: number) => {
    for (const e of entries) {
      upsert.run({ u: userId, c: e.c, s: e.s, lap: e.trace.lapTime, trace: JSON.stringify(e.trace), t: now });
    }
  });

  return {
    get(req: Request): Response {
      const user = requireUser(ctx, req);
      return json({ bests: listBests(ctx, user.id) });
    },

    async put(req: Request): Promise<Response> {
      const user = requireUser(ctx, req);
      const body = v.object(await readJson(req, 1024 * 1024));
      if (!Array.isArray(body.bests)) throw new ApiError(400, 'bests must be an array');
      if (body.bests.length > v.MAX_BESTS_BATCH) throw new ApiError(400, `at most ${v.MAX_BESTS_BATCH} bests per request`);
      const entries = body.bests.map((raw) => {
        const b = v.object(raw, 'best');
        return { c: v.circuitId(b.circuitId), s: v.segmentId(b.segmentId), trace: v.trace(b.trace) };
      });
      apply(user.id, entries, Date.now());
      return json({ bests: listBests(ctx, user.id) });
    },
  };
}
