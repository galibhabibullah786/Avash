import type { MiddlewareHandler } from 'hono';
import { buildGenericErrorBody, logger } from '@avash/logger';
import type { AppEnv } from '../types';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const CLOUDFLARE_TEST_SECRET = '1x0000000000000000000000000000000AA';

interface TurnstileVerifyResponse {
  success?: boolean;
  ['error-codes']?: string[];
}

/**
 * Verifies the Cloudflare Turnstile token a write-path form submits,
 * server-side, before the route's own handler runs. Reads the request
 * body itself (Hono caches the parsed body, so the route handler's later
 * schema parse still sees the same payload) — this middleware runs ahead
 * of the route's zod parse in the chain (auth -> turnstile -> rate-limit).
 * Never logs the token itself (the logger also redacts `token`-keyed
 * fields, but this does not rely on that alone).
 *
 * In local dev (ENVIRONMENT=development), pairs dummy/test tokens with
 * Cloudflare's official always-passing secret key so testing against
 * localhost works out-of-the-box in both online and offline dev environments.
 */
export const turnstile = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const requestId = c.get('requestId');

  let token: string | undefined;
  try {
    const body = (await c.req.json()) as Record<string, unknown> | undefined;
    token = typeof body?.turnstileToken === 'string' ? body.turnstileToken : undefined;
  } catch {
    token = undefined;
  }

  if (!token) {
    return c.json(buildGenericErrorBody(requestId), 403);
  }

  const isDev = c.env.ENVIRONMENT === 'development';
  const isTestToken = token.startsWith('XXXX.') || token.startsWith('test-') || token === '1x00000000000000000000AA';
  const isTestSecret = c.env.TURNSTILE_SECRET_KEY === CLOUDFLARE_TEST_SECRET;

  const secretKey = (isDev && isTestToken) || isTestSecret ? CLOUDFLARE_TEST_SECRET : c.env.TURNSTILE_SECRET_KEY;
  const remoteIp = c.req.header('CF-Connecting-IP') ?? undefined;

  try {
    const params = new URLSearchParams({ secret: secretKey, response: token });
    if (remoteIp) params.set('remoteip', remoteIp);

    const verifyResponse = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const result = (await verifyResponse.json().catch(() => undefined)) as TurnstileVerifyResponse | undefined;

    if (!result?.success) {
      if (isDev && isTestToken) {
        await next();
        return;
      }
      return c.json(buildGenericErrorBody(requestId), 403);
    }
  } catch (error) {
    if (isDev && isTestToken) {
      await next();
      return;
    }
    logger.error('turnstile: verification service unreachable', {
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
    return c.json(buildGenericErrorBody(requestId), 403);
  }

  await next();
};
