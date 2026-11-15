import { z } from 'zod';
import { env } from './env';

/** `API_CLIENT_TIMEOUT_MS` (§14) — aborts a hung request instead of a query pending forever. */
const API_CLIENT_TIMEOUT_MS = 8000;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface FetchApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  body?: unknown;
  /** Supabase access token — sent as `Authorization: Bearer <token>` when set. */
  accessToken?: string;
}

/**
 * Typed fetch wrapper (R2/R3/R4/R10): base URL comes only from the public
 * `VITE_PUBLIC_API_BASE_URL` var, every response is zod-parsed before it is
 * handed back, and failures are returned as a discriminated result rather
 * than thrown — callers never see a raw error or stack trace. A 401/403
 * gets its own distinct message so a caller can prompt re-authentication
 * without reading a server error string.
 */
export async function fetchApi<T>(
  path: string,
  schema: z.ZodType<T>,
  options?: FetchApiOptions
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_CLIENT_TIMEOUT_MS);

  try {
    const hasBody = options?.body !== undefined;
    const response = await fetch(`${env.apiBaseUrl}${path}`, {
      method: options?.method ?? 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(options?.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
    });

    if (response?.status === 401 || response?.status === 403) {
      return { ok: false, error: 'Sign-in required. Please sign in again.' };
    }

    if (!response?.ok) {
      return { ok: false, error: `Request failed with status ${response?.status ?? 'unknown'}` };
    }

    const json = await response.json?.().catch(() => null);
    const parsed = schema.safeParse(json);
    if (!parsed?.success) {
      return { ok: false, error: 'Response did not match the expected shape' };
    }

    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, error: 'Unable to reach the server' };
  } finally {
    clearTimeout(timeoutId);
  }
}
