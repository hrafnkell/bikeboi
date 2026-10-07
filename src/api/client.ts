// Thin fetch wrapper for the bikeboi API. Same origin, cookie session, JSON in and out.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const message =
      typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `request failed (${res.status})`;
    const retry = Number(res.headers.get('retry-after'));
    throw new ApiError(res.status, message, Number.isFinite(retry) && retry > 0 ? retry : null);
  }
  return body as T;
}

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parse<T>(res);
}

export async function apiForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, { method: 'POST', credentials: 'include', cache: 'no-store', body: form });
  return parse<T>(res);
}

/** fetch rejects with a TypeError when the network is down or the server unreachable. */
export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError;
}
