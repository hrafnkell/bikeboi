// Ride history: a summary row plus the FIT file for every finished ride.

import { ApiError, json } from '../http.ts';
import * as v from '../validate.ts';
import { requireUser } from './auth.ts';
import type { AuthContext } from './auth.ts';

/** Per-user storage limits. Tests lower these. */
export const quotas = { maxRides: 2000, maxBytes: 150 * 1024 * 1024 };

interface RideRow {
  id: string;
  startedAt: number;
  circuitId: string;
  circuitName: string;
  filename: string;
  summary: string;
  meta: string;
  fitBytes: number;
  createdAt: number;
}

const COLUMNS = `id, started_at AS startedAt, circuit_id AS circuitId, circuit_name AS circuitName, filename,
  summary, meta, fit_bytes AS fitBytes, created_at AS createdAt`;

type RouteRequest = Request & { params?: Record<string, string> };

function toJson(row: RideRow) {
  return { ...row, summary: JSON.parse(row.summary), meta: JSON.parse(row.meta) };
}

function rideId(req: Request): string {
  const id = (req as RouteRequest).params?.id ?? '';
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new ApiError(404, 'ride not found');
  return id;
}

export function ridesRoutes(ctx: AuthContext) {
  const byId = ctx.db.query(`SELECT ${COLUMNS} FROM rides WHERE user_id = $u AND id = $id`);

  return {
    async create(req: Request): Promise<Response> {
      const user = requireUser(ctx, req);
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        throw new ApiError(400, 'send multipart form data with meta and fit');
      }
      const metaField = form.get('meta');
      const fitField = form.get('fit');
      if (typeof metaField !== 'string') throw new ApiError(400, 'meta is required');
      if (!(fitField instanceof Blob)) throw new ApiError(400, 'fit file is required');
      let metaRaw: unknown;
      try {
        metaRaw = JSON.parse(metaField);
      } catch {
        throw new ApiError(400, 'meta is not JSON');
      }
      const m = v.object(metaRaw, 'meta');
      const startedAt = v.timestamp(m.startedAt);
      const circuitId = v.circuitId(m.circuitId);
      const circuitName = v.shortText(m.circuitName, 'circuitName', 80);
      const filename = v.fitFilename(m.filename);
      const summary = v.rideSummary(m.summary);
      const meta = v.rideMeta(m.meta);
      if (fitField.size > v.MAX_FIT_BYTES) throw new ApiError(413, 'FIT file too large');
      const fit = v.fitBytes(new Uint8Array(await fitField.arrayBuffer()));

      const existing = ctx.db.query(`SELECT ${COLUMNS} FROM rides WHERE user_id = $u AND started_at = $s`).get({ u: user.id, s: startedAt }) as RideRow | null;
      if (existing) return json({ ride: toJson(existing) }, 200);

      const usage = ctx.db.query('SELECT count(*) AS n, coalesce(sum(fit_bytes), 0) AS bytes FROM rides WHERE user_id = $u').get({ u: user.id }) as { n: number; bytes: number };
      if (usage.n >= quotas.maxRides || usage.bytes + fit.length > quotas.maxBytes) throw new ApiError(413, 'storage quota reached');

      const id = Bun.randomUUIDv7();
      ctx.db
        .query(
          `INSERT INTO rides (id, user_id, started_at, circuit_id, circuit_name, filename, summary, meta, fit, fit_bytes, created_at)
           VALUES ($id, $u, $s, $c, $cn, $f, $summary, $meta, $fit, $bytes, $t)`,
        )
        .run({ id, u: user.id, s: startedAt, c: circuitId, cn: circuitName, f: filename, summary: JSON.stringify(summary), meta: JSON.stringify(meta), fit, bytes: fit.length, t: Date.now() });
      return json({ ride: toJson(byId.get({ u: user.id, id }) as RideRow) }, 201);
    },

    list(req: Request): Response {
      const user = requireUser(ctx, req);
      const url = new URL(req.url);
      const limitRaw = Number(url.searchParams.get('limit') ?? 50);
      const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.round(limitRaw))) : 50;
      const beforeRaw = url.searchParams.get('before');
      const before = beforeRaw === null ? Number.MAX_SAFE_INTEGER : Number(beforeRaw);
      if (!Number.isFinite(before)) throw new ApiError(400, 'bad before');
      const rows = ctx.db
        .query(`SELECT ${COLUMNS} FROM rides WHERE user_id = $u AND started_at < $b ORDER BY started_at DESC LIMIT $n`)
        .all({ u: user.id, b: before, n: limit + 1 }) as RideRow[];
      const page = rows.slice(0, limit);
      const nextBefore = rows.length > limit ? page[page.length - 1].startedAt : null;
      return json({ rides: page.map(toJson), nextBefore });
    },

    get(req: Request): Response {
      const user = requireUser(ctx, req);
      const id = rideId(req);
      const row = byId.get({ u: user.id, id }) as RideRow | null;
      if (!row) throw new ApiError(404, 'ride not found');
      return json({ ride: toJson(row), fitUrl: `/api/rides/${id}/fit` });
    },

    fit(req: Request): Response {
      const user = requireUser(ctx, req);
      const id = rideId(req);
      const row = ctx.db.query('SELECT filename, fit FROM rides WHERE user_id = $u AND id = $id').get({ u: user.id, id }) as
        | { filename: string; fit: Uint8Array }
        | null;
      if (!row) throw new ApiError(404, 'ride not found');
      return new Response(new Uint8Array(row.fit) as Uint8Array<ArrayBuffer>, {
        headers: {
          'content-type': 'application/octet-stream',
          'content-disposition': `attachment; filename="${row.filename}"`,
          'cache-control': 'no-store',
        },
      });
    },

    remove(req: Request): Response {
      const user = requireUser(ctx, req);
      const id = rideId(req);
      const result = ctx.db.query('DELETE FROM rides WHERE user_id = $u AND id = $id').run({ u: user.id, id });
      if (result.changes === 0) throw new ApiError(404, 'ride not found');
      return json({ ok: true });
    },
  };
}
