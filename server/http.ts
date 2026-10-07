// Request plumbing for the JSON API: errors, headers, cookies, body limits, CSRF checks.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

const API_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  vary: 'cookie',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...API_HEADERS, ...extra } });
}

export function fail(e: unknown): Response {
  if (e instanceof ApiError) {
    const extra: Record<string, string> = e.retryAfter ? { 'retry-after': String(e.retryAfter) } : {};
    return json({ error: e.message }, e.status, extra);
  }
  console.error('bikeboi: api error', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  return json({ error: 'server error' }, 500);
}

/**
 * A request from another site cannot be allowed to change anything. Browsers send Origin
 * on cross-site requests; its host must be ours. Fetches without Origin or Sec-Fetch-Site
 * come from non-browser clients and are let through (they carry no cookies anyway).
 */
export function checkOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  if (origin) {
    let host = '';
    try {
      host = new URL(origin).host;
    } catch {
      throw new ApiError(403, 'bad origin');
    }
    if (host !== req.headers.get('host')) throw new ApiError(403, 'cross-site request refused');
    return;
  }
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new ApiError(403, 'cross-site request refused');
}

/** Wraps a handler: origin check for writes, API headers, error mapping. */
export function api(handler: (req: Request) => Promise<Response> | Response) {
  return async (req: Request): Promise<Response> => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') checkOrigin(req);
      const res = await handler(req);
      for (const [k, v] of Object.entries(API_HEADERS)) if (!res.headers.has(k)) res.headers.set(k, v);
      return res;
    } catch (e) {
      return fail(e);
    }
  };
}

/** Parses a JSON body of limited size; requires the JSON content type (a cross-site form cannot send it). */
export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) throw new ApiError(415, 'send JSON');
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > maxBytes) throw new ApiError(413, 'request too large');
  const text = await req.text();
  if (text.length > maxBytes) throw new ApiError(413, 'request too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, 'malformed JSON');
  }
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name) out[name] = part.slice(eq + 1).trim();
  }
  return out;
}

export const SESSION_COOKIE = 'bb_session';

export function sessionCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** The address a request came from: the first X-Forwarded-For entry behind a trusted proxy, else the socket. */
export function clientIp(req: Request, socketAddress: string | null, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers.get('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0].trim();
  }
  return socketAddress ?? 'unknown';
}
