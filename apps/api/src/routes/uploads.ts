import { Hono } from 'hono';
import { buildGenericErrorBody } from '@avash/logger';
import type { RateLimitRedisLike } from '@avash/security';
import { auth } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv, Bindings } from '../types';

export interface CreateUploadsOptions {
  /** Test seam — route tests inject a fake in place of a real Upstash client. */
  redisFactory?: (env: Bindings) => RateLimitRedisLike;
}

/**
 * Signed direct-to-Cloudinary uploads (decision G, ADR-015). This stub
 * mounts the route's final chain — every signed-in role may mint a
 * signature, so `auth()` carries no `capability` — and returns 501 until
 * A-T01 replaces the body. The `UPLOAD_SIGNATURE_RATE_LIMIT` named
 * constant (§14, documented in P0-T03) is wired into
 * `packages/security/rateLimit.ts` in A-T05; this stub uses its
 * documented value (10/min per user) inline until then.
 */
export function createUploads(options?: CreateUploadsOptions) {
  return new Hono<AppEnv>().post(
    '/',
    auth(),
    rateLimit({
      guard: 'upload-signature',
      window: 'minute',
      windowSeconds: 60,
      limit: 10,
      keyStrategy: 'user',
      redisFactory: options?.redisFactory,
    }),
    async (c) => {
      const requestId = c.get('requestId');
      return c.json(buildGenericErrorBody(requestId), 501);
    }
  );
}

export const uploads = createUploads();
