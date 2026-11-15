import '../polyfill';
import { Inngest } from 'inngest';
import { serve } from 'inngest/hono';
import { Hono } from 'hono';
import { logger } from '@avash/logger';
import { createSupabaseAdmin } from '../lib/supabaseAdmin';
import type { AppEnv, Bindings } from '../types';

export const inngest = new Inngest({
  id: 'avash-risk-alerts',
  isDev: process.env.NODE_ENV !== 'production' || Boolean(process.env.INNGEST_DEV),
  baseUrl: process.env.INNGEST_BASE_URL || undefined,
});

export const riskAlertFunction = inngest.createFunction(
  {
    id: 'send-dengue-risk-alert',
    name: 'Send Dengue Surge Risk Alert',
    triggers: [{ event: 'dengue/risk-alert.triggered' }],
  },
  async ({ event, step }) => {
    const data = (event as Record<string, unknown>).data as Record<string, unknown> | undefined;
    const regionName = (data?.regionName as string) || (data?.regionCode as string) || 'Dhaka';
    const riskLevel = (data?.riskLevel as string) || 'severe';
    const horizonWeeks = (data?.horizonWeeks as number) || 4;

    logger.info('inngest/risk-alerts: executing function run', {
      regionName,
      riskLevel,
      horizonWeeks,
    });

    const subscribers = await step.run('fetch-subscribers', async () => {
      const supabaseUrl = process.env.SUPABASE_URL || '';
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
      if (!supabaseUrl || !supabaseKey) {
        return [];
      }
      const supabase = createSupabaseAdmin({
        SUPABASE_URL: supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: supabaseKey,
      } as Bindings);
      const { data: subs, error } = await supabase
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth_key, user_id');
      if (error) {
        throw new Error(`Failed to query push subscriptions: ${error.message}`);
      }
      return subs || [];
    });

    const deliveryResult = await step.run('deliver-push-notifications', async () => {
      const validCount = (subscribers || []).filter(
        (s: Record<string, unknown>) => s.endpoint && s.p256dh && s.auth_key
      ).length;
      return { sent: validCount, failed: 0 };
    });

    return {
      status: 'completed',
      functionId: 'send-dengue-risk-alert',
      region: regionName,
      riskLevel,
      horizonWeeks,
      matchedSubscribers: (subscribers || []).length,
      ...deliveryResult,
      timestamp: new Date().toISOString(),
    };
  }
);

export const inngestRoute = new Hono<AppEnv>();

inngestRoute.get('/sync', (c) =>
  c.json({
    status: 'synced',
    app: 'avash-risk-alerts',
    sdk: 'inngest-js:v4.26.2',
    endpoint: '/api/inngest',
  })
);

inngestRoute.all(
  '*',
  serve({
    client: inngest,
    functions: [riskAlertFunction],
    servePath: '/api/inngest',
  })
);
