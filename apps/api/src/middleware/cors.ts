import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';
import { isAllowedOrigin, CORS_PREFLIGHT_MAX_AGE_S } from '../config/cors';

/**
 * Strict origin allow-list (`CORS_ALLOWED_ORIGINS`, §14). Unlisted origins
 * get no CORS headers back at all — never a wildcard, never an echoed
 * origin without a match. No `Access-Control-Allow-Credentials` since the
 * API uses Bearer JWT, not cookies (§7.4).
 */
export const corsMiddleware = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const origin = c.req.header('Origin');
  const allowed = isAllowedOrigin(origin, c.env);

  if (c.req.method === 'OPTIONS') {
    if (!allowed) {
      return c.body(null, 403);
    }
    const requestHeaders = c.req.header('Access-Control-Request-Headers');
    c.header('Access-Control-Allow-Origin', origin as string);
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    c.header(
      'Access-Control-Allow-Headers',
      requestHeaders
        ? `Content-Type, Authorization, Accept, X-Request-Id, ${requestHeaders}`
        : 'Content-Type, Authorization, Accept, X-Request-Id'
    );
    c.header('Access-Control-Expose-Headers', 'X-Request-Id');
    c.header('Access-Control-Max-Age', String(CORS_PREFLIGHT_MAX_AGE_S));
    c.header('Vary', 'Origin, Access-Control-Request-Headers');
    return c.body(null, 204);
  }

  try {
    await next();
  } finally {
    if (allowed) {
      c.header('Access-Control-Allow-Origin', origin as string);
      c.header('Access-Control-Expose-Headers', 'X-Request-Id');
      c.header('Vary', 'Origin');
    }
  }
};
