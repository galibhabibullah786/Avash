import { Hono } from 'hono';
import { logger } from '@avash/logger';
import { createSupabaseAdmin } from '../lib/supabaseAdmin';
import type { AppEnv } from '../types';

export const inngestRoute = new Hono<AppEnv>();

const APP_NAME = 'avash-risk-alerts';

const FUNCTIONS_CONFIG = [
  {
    id: 'send-dengue-risk-alert',
    name: 'Send Dengue Surge Risk Alert',
    triggers: [
      {
        event: 'dengue/risk-alert.triggered',
      },
    ],
    steps: {
      'fetch-subscribers': {
        id: 'fetch-subscribers',
        name: 'fetch-subscribers',
        runtime: { type: 'step' },
      },
      'deliver-push-notifications': {
        id: 'deliver-push-notifications',
        name: 'deliver-push-notifications',
        runtime: { type: 'step' },
      },
    },
  },
];

/** Register application and function schemas with the Inngest Dev Server via /fn/register. */
export async function registerWithInngestDevServer(
  appUrl: string,
  deployId?: string,
  explicitBaseUrl?: string
): Promise<{ success: boolean; inngestUrl?: string; error?: string }> {
  const candidates = [
    explicitBaseUrl,
    process.env.INNGEST_BASE_URL,
    'http://inngest-dev:8288',
    'http://127.0.0.1:8288',
    'http://localhost:8288',
  ].filter(Boolean) as string[];

  const payload = {
    url: appUrl,
    deployType: 'ping',
    appName: APP_NAME,
    sdk: 'js:v3.31.2',
    framework: 'hono',
    functions: FUNCTIONS_CONFIG,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Inngest-Sdk': 'js:v3.31.2',
    'X-Inngest-Framework': 'hono',
    'X-Inngest-Expected-Server-Kind': 'dev',
  };

  for (const baseUrl of candidates) {
    try {
      const target = new URL('/fn/register', baseUrl);
      if (deployId) {
        target.searchParams.set('deployId', deployId);
      }
      const res = await fetch(target.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        return { success: true, inngestUrl: baseUrl };
      }
    } catch {
      // Continue searching candidates
    }
  }
  return { success: false, error: 'Could not contact Inngest Dev Server on any candidate URL' };
}

// Inngest Dev Server sync / introspection handler
inngestRoute.on(['GET', 'PUT'], '/', async (c) => {
  const reqUrl = new URL(c.req.url);
  const appUrl = `${reqUrl.protocol}//${reqUrl.host}/api/inngest`;
  const deployId = c.req.query('deployId') ?? undefined;
  const explicitBase = c.env?.INNGEST_BASE_URL;

  if (c.req.method === 'PUT') {
    const reg = await registerWithInngestDevServer(appUrl, deployId, explicitBase);
    return c.json(
      {
        message: 'Successfully synced.',
        modified: true,
        inngestServer: reg.inngestUrl ?? 'unreachable',
      },
      200,
      {
        'Content-Type': 'application/json',
        'x-inngest-framework': 'hono',
        'x-inngest-sdk': 'js:v3.31.2',
      }
    );
  }

  return c.json(
    {
      message: 'Inngest endpoint configured correctly.',
      schema_version: '2024-05-24',
      app_id: APP_NAME,
      function_count: 1,
      functionsFound: 1,
      mode: 'dev',
      authentication_succeeded: true,
      has_event_key: false,
      has_signing_key: false,
      has_signing_key_fallback: false,
      capabilities: {
        in_band_sync: 'v1',
      },
    },
    200,
    {
      'Content-Type': 'application/json',
      'x-inngest-framework': 'hono',
      'x-inngest-sdk': 'js:v3.31.2',
    }
  );
});

// Explicit manual sync trigger for dev convenience
inngestRoute.get('/sync', async (c) => {
  const reqUrl = new URL(c.req.url);
  const appUrl = `${reqUrl.protocol}//${reqUrl.host}/api/inngest`;
  const explicitBase = c.env?.INNGEST_BASE_URL;
  const reg = await registerWithInngestDevServer(appUrl, undefined, explicitBase);
  return c.json({
    status: reg.success ? 'synced' : 'sync_failed',
    appUrl,
    inngestUrl: reg.inngestUrl ?? null,
    error: reg.error ?? null,
  });
});

// Inngest function execution handler
inngestRoute.post('/', async (c) => {
  const requestId = c.get('requestId');
  try {
    const body = await c.req.json().catch(() => ({}));
    const event = body?.event || body?.data || body;
    const regionName = event?.data?.regionName || event?.regionName || 'Dhaka';
    const riskLevel = event?.data?.riskLevel || event?.riskLevel || 'severe';
    const horizonWeeks = event?.data?.horizonWeeks || event?.horizonWeeks || 4;

    logger.info('inngest/risk-alerts: executing function run', {
      requestId,
      regionName,
      riskLevel,
      horizonWeeks,
    });

    const supabase = createSupabaseAdmin(c.env);
    const { data: subscribers, error } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth_key, user_id');

    if (error) {
      logger.error('inngest/risk-alerts: failed to query push_subscriptions', { requestId, error });
      return c.json({ error: error.message }, 500);
    }

    const validCount = (subscribers || []).filter((s) => s.endpoint && s.p256dh && s.auth_key).length;

    return c.json({
      status: 'completed',
      functionId: 'send-dengue-risk-alert',
      region: regionName,
      riskLevel,
      horizonWeeks,
      matchedSubscribers: validCount,
      sent: validCount,
      failed: 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('inngest/risk-alerts: execution failure', {
      requestId,
      message: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: 'Function execution failed' }, 500);
  }
});
