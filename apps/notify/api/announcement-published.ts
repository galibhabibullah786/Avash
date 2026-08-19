import { randomUUID, timingSafeEqual } from 'node:crypto';
import { announcementWebhookBodySchema } from '@avash/types';
import { inngest } from '../src/inngest/client';

/**
 * Supabase Database Webhook receiver — `AFTER INSERT ON announcements`.
 * Constant-time compares the shared-secret header, parses the body with
 * `announcementWebhookBodySchema`, and uses only `record.id` —
 * everything else is re-read from the database rather than trusted from
 * the payload (critique §11, temp/live-announcement-push.md). Emits the
 * `announcement/published` Inngest event and returns `202` with no body.
 */

/**
 * Header carrying the shared secret configured in Supabase's Database
 * Webhook setup, compared against `ANNOUNCEMENT_WEBHOOK_SECRET`.
 */
const WEBHOOK_SECRET_HEADER = 'x-announcement-webhook-secret';

/**
 * Constant-time string comparison via `crypto.timingSafeEqual` — never
 * `===`, which short-circuits on the first mismatched byte and leaks
 * timing information about how much of the secret was guessed
 * correctly. `timingSafeEqual` itself requires equal-length buffers, so
 * a length mismatch is handled explicitly first; that branch is a real
 * timing leak of length only, not of content, which is the accepted
 * tradeoff every constant-time-compare guide makes (there is no way to
 * compare buffers of different length in constant time).
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function handleAnnouncementPublishedWebhook(request: Request): Promise<Response> {
  const correlationId = randomUUID();
  const expectedSecret = process.env?.ANNOUNCEMENT_WEBHOOK_SECRET;
  const providedSecret = request?.headers?.get(WEBHOOK_SECRET_HEADER);

  if (!expectedSecret || !providedSecret || !constantTimeEquals(providedSecret, expectedSecret)) {
    console.warn(`announcement-published webhook: authentication failed [correlationId=${correlationId}]`);
    return new Response(null, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    console.warn(`announcement-published webhook: request body was not valid JSON [correlationId=${correlationId}]`);
    return new Response(null, { status: 400 });
  }

  const parsed = announcementWebhookBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    console.warn(`announcement-published webhook: request body failed schema validation [correlationId=${correlationId}]`);
    return new Response(null, { status: 400 });
  }

  // Only `record.id` is ever used. Zod already dropped every other
  // key `record` carried (radius, roles, title, whatever) — this
  // destructure is a second, explicit line of defense against a future
  // schema change accidentally starting to trust more of the body.
  const announcementId = parsed.data.record.id;

  await inngest.send({ name: 'announcement/published', data: { id: announcementId } });

  return new Response(null, { status: 202 });
}

// Vercel's Node.js Function runtime invokes the default export of an
// `api/*.ts` file as its handler — a named export alone (kept above for
// server/node-server.ts's direct import and for the test file) is never
// picked up, so without this the route builds but 500s on every real
// request.
export default handleAnnouncementPublishedWebhook;
