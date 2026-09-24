import { InngestTestEngine } from '@inngest/test';
import { ANNOUNCEMENT_PUSH_RUN_CONCURRENCY, INNGEST_PLAN_CONCURRENCY_LIMIT } from '@avash/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverAnnouncementFn, handleAnnouncementPublished } from './deliverAnnouncement';

const ANNOUNCEMENT_ID = '11111111-1111-1111-1111-111111111111';

const ENV_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
] as const;

/* eslint-disable no-restricted-syntax -- server-only test code (apps/notify
   is never bundled to a browser); packages/config/eslint-config's
   `noNonPublicEnvUnderWeb` rule is meant for apps/web only but its `files`
   glob is missing an `apps/web/` prefix, so it misfires on every app's
   src/ tree. Flagged for a shared-config fix, worked around locally here. */
function withRequiredEnv(): () => void {
  const previous: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) previous[key] = process.env[key];
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  process.env.VAPID_PUBLIC_KEY = 'vapid-public';
  process.env.VAPID_PRIVATE_KEY = 'vapid-private';
  return () => {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
}
/* eslint-enable no-restricted-syntax */

describe('handleAnnouncementPublished (frozen stub signature)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when event.id is missing rather than silently no-opting', async () => {
    // @ts-expect-error -- testing a malformed event
    await expect(handleAnnouncementPublished({})).rejects.toThrow(/event.id is required/);
  });

  it('throws a clear error when required env vars are missing', async () => {
    const restore = withRequiredEnv();
    // eslint-disable-next-line no-restricted-syntax -- see withRequiredEnv()'s comment above
    delete process.env.SUPABASE_URL;
    await expect(handleAnnouncementPublished({ id: ANNOUNCEMENT_ID })).rejects.toThrow(/SUPABASE_URL/);
    restore();
  });
});

describe('deliverAnnouncementFn', () => {
  it('has a stable function id', () => {
    expect(deliverAnnouncementFn.id()).toBe('announcement-push-delivery');
  });

  it('is configured with idempotency keyed on the announcement id', () => {
    expect(deliverAnnouncementFn.opts.idempotency).toBe('event.data.id');
  });

  it('bounds concurrent runs at ANNOUNCEMENT_PUSH_RUN_CONCURRENCY', () => {
    expect(deliverAnnouncementFn.opts.concurrency).toEqual({ limit: ANNOUNCEMENT_PUSH_RUN_CONCURRENCY });
  });

  // Regression guard for a silent, deploy-green outage: Inngest rejects
  // the WHOLE app registration (`PUT /api/inngest` -> 400, `modified:
  // false`) when any function declares more concurrency than the plan
  // allows, so no function registers and no announcement is ever
  // delivered. Asserting the declared limit against the plan ceiling
  // catches a raise here that is not accompanied by a plan upgrade.
  it('declares no more run concurrency than the Inngest plan allows', () => {
    expect(ANNOUNCEMENT_PUSH_RUN_CONCURRENCY).toBeLessThanOrEqual(INNGEST_PLAN_CONCURRENCY_LIMIT);
  });

  it('triggers on the announcement/published event', () => {
    expect(deliverAnnouncementFn.opts.triggers).toEqual([{ event: 'announcement/published' }]);
  });

  it('runs resolve-delivery-config then deliver-announcement, and a later step does not re-run an already-succeeded step', async () => {
    const restore = withRequiredEnv();
    const resolveConfigHandler = vi.fn(() => ({
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceRoleKey: 'service-role-key',
      vapidPublicKey: 'vapid-public',
      vapidPrivateKey: 'vapid-private',
      vapidSubject: 'mailto:support@avash.app',
    }));
    // Fails once — modelling a transient delivery error inside the
    // second step.
    const deliverHandler = vi.fn(() => {
      throw new Error('transient delivery failure');
    });

    // A single `InngestTestEngine` memoizes each mocked step's handler
    // result across every execution run against it (`@inngest/test`'s
    // mock handler cache is keyed by step id, scoped to the engine
    // instance, per its own source) — this is exactly the property that
    // makes it useful for modelling a retry: a second execution attempt
    // against the same engine must replay an already-succeeded step's
    // memoized output rather than calling its handler again.
    const t = new InngestTestEngine({
      function: deliverAnnouncementFn,
      events: [{ name: 'announcement/published', data: { id: ANNOUNCEMENT_ID } }],
      steps: [
        { id: 'resolve-delivery-config', handler: resolveConfigHandler },
        { id: 'deliver-announcement', handler: deliverHandler },
      ],
    });

    // First attempt: 'resolve-delivery-config' succeeds, 'deliver-announcement' throws.
    await t.execute();
    expect(resolveConfigHandler).toHaveBeenCalledTimes(1);
    expect(deliverHandler).toHaveBeenCalledTimes(1);
    // The mock itself threw (this is what "a thrown error inside one
    // step" means here) — asserted directly on the mock rather than on
    // however the test engine happens to surface a rejected run, which
    // is the more reliable signal.
    expect(deliverHandler.mock.results[0]?.type).toBe('throw');

    // Simulate the platform retrying the run after that failure, on the
    // SAME engine instance. If this implementation re-ran the whole
    // function from scratch on retry, `resolveConfigHandler` — a step
    // that already succeeded — would be called a second time here.
    await t.execute();
    expect(resolveConfigHandler).toHaveBeenCalledTimes(1);

    restore();
  });

  it('returns the AnnouncementPushResult from the deliver-announcement step as the function result', async () => {
    const expectedResult = {
      announcementId: ANNOUNCEMENT_ID,
      claimed: true,
      targetCount: 3,
      sent: 3,
      gone: 0,
      failed: 0,
    };

    const t = new InngestTestEngine({ function: deliverAnnouncementFn });
    const { result } = await t.execute({
      events: [{ name: 'announcement/published', data: { id: ANNOUNCEMENT_ID } }],
      steps: [
        {
          id: 'resolve-delivery-config',
          handler: () => ({
            supabaseUrl: 'https://example.supabase.co',
            supabaseServiceRoleKey: 'service-role-key',
            vapidPublicKey: 'vapid-public',
            vapidPrivateKey: 'vapid-private',
            vapidSubject: 'mailto:support@avash.app',
          }),
        },
        { id: 'deliver-announcement', handler: () => expectedResult },
      ],
    });

    expect(result).toEqual(expectedResult);
  });
});
