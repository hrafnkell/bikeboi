// Connecting an intervals.icu account and sending rides to it.

import type { Database } from 'bun:sqlite';
import { open, seal } from '../crypto.ts';
import { ApiError, json, readJson } from '../http.ts';
import { IntervalsError, uploadActivity, whoAmI } from '../intervals.ts';
import * as v from '../validate.ts';
import { requireUser } from './auth.ts';
import type { AuthContext } from './auth.ts';

interface ConnectionRow {
  api_key: Uint8Array;
  athlete_id: string;
  athlete_name: string;
  auto: number;
  connected_at: number;
}

function connection(db: Database, userId: number): ConnectionRow | null {
  return db.query('SELECT api_key, athlete_id, athlete_name, auto, connected_at FROM intervals WHERE user_id = $u').get({ u: userId }) as ConnectionRow | null;
}

function status(row: ConnectionRow | null) {
  return row
    ? { connected: true, athleteId: row.athlete_id, athleteName: row.athlete_name, auto: row.auto === 1, connectedAt: row.connected_at }
    : { connected: false, athleteId: '', athleteName: '', auto: false, connectedAt: 0 };
}

function asApiError(e: unknown): never {
  if (e instanceof IntervalsError) throw new ApiError(e.status === 401 ? 400 : e.status, e.message);
  throw e;
}

export interface RideForUpload {
  id: string;
  filename: string;
  circuitName: string;
  summary: { durationS: number; distanceM: number; avgPower: number; laps: number };
  meta: { pacer?: number | null; workout?: string | null };
  fit: Uint8Array;
}

/**
 * Sends one ride to the rider's intervals.icu and records the outcome on the ride row.
 * Returns the activity id ('' for a duplicate that came back without one) or throws.
 */
export async function sendRide(ctx: AuthContext, userId: number, ride: RideForUpload): Promise<{ activityId: string; duplicate: boolean }> {
  const row = connection(ctx.db, userId);
  if (!row) throw new ApiError(409, 'intervals.icu is not connected');
  if (!ctx.secretKey) throw new ApiError(503, 'intervals.icu is not configured on this server');
  const apiKey = await open(ctx.secretKey, row.api_key);
  const s = ride.summary;
  const minutes = Math.round(s.durationS / 60);
  const bits = [`${(s.distanceM / 1000).toFixed(1)} km`, `${minutes} min`, `${Math.round(s.avgPower)} W avg`, `${s.laps} lap${s.laps === 1 ? '' : 's'}`];
  if (ride.meta.workout) bits.push(`workout: ${ride.meta.workout}`);
  else if (ride.meta.pacer) bits.push(`pacemaker ${ride.meta.pacer} W`);
  try {
    const result = await uploadActivity(ctx.fetch, apiKey, {
      fit: ride.fit,
      filename: ride.filename,
      name: `bikeboi: ${ride.circuitName}`,
      description: `${bits.join(' · ')}\nRidden on bikeboi.hlekkir.is`,
      externalId: `bikeboi:${ride.id}`,
    });
    ctx.db.query('UPDATE rides SET intervals_id = $a, intervals_at = $t, intervals_error = NULL WHERE id = $id AND user_id = $u')
      .run({ a: result.activityId, t: Date.now(), id: ride.id, u: userId });
    return result;
  } catch (e) {
    const message = e instanceof IntervalsError ? e.message : 'upload failed';
    ctx.db.query('UPDATE rides SET intervals_error = $m WHERE id = $id AND user_id = $u').run({ m: message, id: ride.id, u: userId });
    throw e;
  }
}

export function autoUploadEnabled(ctx: AuthContext, userId: number): boolean {
  const row = connection(ctx.db, userId);
  return !!row && row.auto === 1 && !!ctx.secretKey;
}

export function intervalsRoutes(ctx: AuthContext) {
  return {
    get(req: Request): Response {
      const user = requireUser(ctx, req);
      return json({ ...status(connection(ctx.db, user.id)), available: !!ctx.secretKey });
    },

    /** {apiKey?, auto?}: a key connects (after checking it with intervals.icu); auto alone just flips the switch. */
    async put(req: Request): Promise<Response> {
      const user = requireUser(ctx, req);
      const body = v.object(await readJson(req));
      const existing = connection(ctx.db, user.id);
      if (body.apiKey !== undefined) {
        if (!ctx.secretKey) throw new ApiError(503, 'intervals.icu is not configured on this server');
        if (typeof body.apiKey !== 'string' || body.apiKey.trim().length < 8 || body.apiKey.length > 200) throw new ApiError(400, 'that does not look like an API key');
        const apiKey = body.apiKey.trim();
        const athlete = await whoAmI(ctx.fetch, apiKey).catch(asApiError);
        const auto = body.auto === undefined ? (existing ? existing.auto === 1 : true) : body.auto === true;
        ctx.db.query(
          `INSERT INTO intervals (user_id, api_key, athlete_id, athlete_name, auto, connected_at) VALUES ($u, $k, $id, $name, $auto, $t)
           ON CONFLICT(user_id) DO UPDATE SET api_key = excluded.api_key, athlete_id = excluded.athlete_id, athlete_name = excluded.athlete_name, auto = excluded.auto, connected_at = excluded.connected_at`,
        ).run({ u: user.id, k: await seal(ctx.secretKey, apiKey), id: athlete.id, name: athlete.name.slice(0, 80), auto: auto ? 1 : 0, t: Date.now() });
      } else if (body.auto !== undefined) {
        if (!existing) throw new ApiError(409, 'intervals.icu is not connected');
        ctx.db.query('UPDATE intervals SET auto = $auto WHERE user_id = $u').run({ auto: body.auto === true ? 1 : 0, u: user.id });
      } else {
        throw new ApiError(400, 'nothing to change');
      }
      return json(status(connection(ctx.db, user.id)));
    },

    remove(req: Request): Response {
      const user = requireUser(ctx, req);
      ctx.db.query('DELETE FROM intervals WHERE user_id = $u').run({ u: user.id });
      return json({ ok: true });
    },
  };
}
