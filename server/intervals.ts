// Talking to intervals.icu with a rider's personal API key.

export const INTERVALS_BASE = 'https://intervals.icu';
const TIMEOUT_MS = 15_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface IntervalsAthlete {
  id: string;
  name: string;
}

export class IntervalsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function auth(apiKey: string): string {
  return `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`;
}

async function call(fetchImpl: FetchLike, apiKey: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', auth(apiKey));
  let res: Response;
  try {
    res = await fetchImpl(`${INTERVALS_BASE}${path}`, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new IntervalsError(502, 'could not reach intervals.icu');
  }
  if (res.status === 401 || res.status === 403) throw new IntervalsError(401, 'intervals.icu rejected the API key');
  if (res.status === 429) throw new IntervalsError(429, 'intervals.icu is rate limiting; try again later');
  if (!res.ok) throw new IntervalsError(502, `intervals.icu answered ${res.status}`);
  return res;
}

/** Checks a key by asking who owns it. Athlete "0" means the key's owner. */
export async function whoAmI(fetchImpl: FetchLike, apiKey: string): Promise<IntervalsAthlete> {
  const res = await call(fetchImpl, apiKey, '/api/v1/athlete/0');
  const body = (await res.json()) as { id?: unknown; name?: unknown; firstname?: unknown; lastname?: unknown };
  const id = typeof body.id === 'string' ? body.id : '';
  const name = typeof body.name === 'string' && body.name
    ? body.name
    : [body.firstname, body.lastname].filter((x) => typeof x === 'string' && x).join(' ');
  if (!id) throw new IntervalsError(502, 'unexpected answer from intervals.icu');
  return { id, name: name || id };
}

export interface UploadInput {
  fit: Uint8Array;
  filename: string;
  name: string;
  description: string;
  /** Our ride id; intervals.icu keeps it, which helps when looking at the activity later. */
  externalId: string;
}

export interface UploadResult {
  /** The activity's id on intervals.icu, or '' when it was a duplicate without ids in the answer. */
  activityId: string;
  duplicate: boolean;
}

/** Uploads a FIT file. intervals.icu de-duplicates by file hash: 201 new, 200 already there. */
export async function uploadActivity(fetchImpl: FetchLike, apiKey: string, input: UploadInput): Promise<UploadResult> {
  const params = new URLSearchParams({ name: input.name, description: input.description, device_name: 'bikeboi', external_id: input.externalId });
  const form = new FormData();
  const bytes = new Uint8Array(new ArrayBuffer(input.fit.length));
  bytes.set(input.fit);
  form.append('file', new Blob([bytes], { type: 'application/octet-stream' }), input.filename);
  const res = await call(fetchImpl, apiKey, `/api/v1/athlete/0/activities?${params}`, { method: 'POST', body: form });
  const body = (await res.json().catch(() => ({}))) as { activities?: Array<{ id?: unknown }> };
  const first = body.activities?.find((a) => typeof a.id === 'string');
  return { activityId: typeof first?.id === 'string' ? first.id : '', duplicate: res.status === 200 };
}
