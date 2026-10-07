// Who is signed in. Optional: the app works without an account.

import { reactive } from 'vue';
import { ApiError, api, isNetworkError } from '../api/client.ts';

export interface AccountUser {
  id: number;
  email: string;
}

export type AccountStatus = 'unknown' | 'anon' | 'in';

export const account = reactive({
  status: 'unknown' as AccountStatus,
  user: null as AccountUser | null,
  busy: false,
});

const LAST_USER_KEY = 'bikeboi:account:lastUserId';

/** The user who last synced in this browser, or null. */
export function lastUserId(): number | null {
  try {
    const v = Number(globalThis.localStorage?.getItem(LAST_USER_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function rememberUser(id: number): void {
  try {
    globalThis.localStorage?.setItem(LAST_USER_KEY, String(id));
  } catch {
    // nothing to do
  }
}

function signedIn(user: AccountUser): void {
  account.user = user;
  account.status = 'in';
}

export function signedOut(): void {
  account.user = null;
  account.status = 'anon';
}

/** Ask the server who we are. Offline keeps the last known state, or anonymous. */
export async function refresh(): Promise<void> {
  try {
    const { user } = await api<{ user: AccountUser | null }>('GET', '/api/auth/me');
    if (user) signedIn(user);
    else signedOut();
  } catch (e) {
    if (isNetworkError(e) && account.status === 'in') return;
    signedOut();
  }
}

async function authenticate(path: string, email: string, password: string): Promise<void> {
  account.busy = true;
  try {
    const { user } = await api<{ user: AccountUser }>('POST', path, { email, password });
    signedIn(user);
  } finally {
    account.busy = false;
  }
}

export function login(email: string, password: string): Promise<void> {
  return authenticate('/api/auth/login', email, password);
}

export function register(email: string, password: string): Promise<void> {
  return authenticate('/api/auth/register', email, password);
}

export async function logout(): Promise<void> {
  account.busy = true;
  try {
    await api('POST', '/api/auth/logout');
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
  } finally {
    account.busy = false;
    signedOut();
  }
}

export async function deleteAccount(password: string): Promise<void> {
  account.busy = true;
  try {
    await api('DELETE', '/api/account', { password });
    signedOut();
  } finally {
    account.busy = false;
  }
}

/** A message for people, from whatever went wrong. */
export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    return e.status === 429 && e.retryAfter ? `${e.message} (${Math.ceil(e.retryAfter / 60)} min)` : e.message;
  }
  if (isNetworkError(e)) return 'Cannot reach the server. Are you online?';
  return e instanceof Error ? e.message : String(e);
}
