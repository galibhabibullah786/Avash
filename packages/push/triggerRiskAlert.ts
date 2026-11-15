import type { SupabaseClient } from '@supabase/supabase-js';
import {
  sendWebPush,
  type SendWebPushOptions,
  type SendWebPushResult,
  type WebPushSubscription,
  type WebPushVapidConfig,
} from './webPush';

export interface TriggerRiskAlertOptions {
  supabase?: SupabaseClient;
  vapid: WebPushVapidConfig;
  regionName: string;
  riskLevel?: 'moderate' | 'high' | 'severe';
  riskScore?: number;
  horizonWeeks?: number;
  broadcastAll?: boolean;
  testSubscription?: WebPushSubscription;
  sendFn?: (options: SendWebPushOptions) => Promise<SendWebPushResult>;
  onProgress?: (info: { id?: string; endpoint: string; outcome: string; statusCode: number; error?: string }) => void;
}

export interface TriggerRiskAlertResult {
  sent: number;
  failed: number;
  subscribersCount: number;
  alertPayload: Record<string, any>;
  details: Array<{ id?: string; outcome: string; statusCode: number }>;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371.0;
  const toRad = (deg: number) => (deg * Math.PI) / 180.0;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * r * Math.asin(Math.sqrt(a));
}

export async function triggerRiskAlertPush(
  options: TriggerRiskAlertOptions,
): Promise<TriggerRiskAlertResult> {
  const band = options.riskLevel || 'severe';
  const score = options.riskScore ?? 0.85;
  const horizon = options.horizonWeeks ?? 4;
  const region = options.regionName || 'Dhaka';
  const send = options.sendFn || sendWebPush;

  const alertPayload = {
    title: `Dengue risk ${band.toUpperCase()} — ${region}`,
    body: `Predicted ${horizon}-week surge risk for ${region} is ${band} (${score.toFixed(2)}). Limit stagnant water and seek medical advice on symptoms. This is an early-warning notice, not medical advice.`,
    data: {
      region,
      horizon_weeks: horizon,
      risk_score: score,
      band,
      model_version: '2.0.0',
      url: '/risk-map',
    },
  };

  const targets: Array<{ id?: string; subscription: WebPushSubscription }> = [];

  if (options.testSubscription) {
    targets.push({ id: 'test-direct', subscription: options.testSubscription });
  } else if (options.supabase) {
    const supabase = options.supabase;

    // 1. Fetch push subscriptions
    const { data: pushRows } = await supabase
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth_key');

    const validPush = (pushRows || []).filter(
      (r: any) => r?.endpoint && r?.p256dh && r?.auth_key,
    );

    // 2. Fetch region coordinates for proximity matching
    const { data: regions } = await supabase
      .from('region_ingest_targets')
      .select('region_id, name, lat, lon');

    const matchedRegion = (regions || []).find(
      (r: any) => String(r.name).toLowerCase() === region.toLowerCase(),
    );

    let matchedUserIds: Set<string> | null = null;

    if (matchedRegion && matchedRegion.lat != null && matchedRegion.lon != null) {
      const regLat = Number(matchedRegion.lat);
      const regLon = Number(matchedRegion.lon);

      const { data: alerts } = await supabase
        .from('alert_subscriptions')
        .select('id, user_id, geom, radius_m, active')
        .eq('active', true);

      matchedUserIds = new Set<string>();
      for (const a of alerts || []) {
        if (!a?.user_id) continue;
        const geom = a.geom;
        if (geom && geom.type === 'Point' && Array.isArray(geom.coordinates)) {
          const [subLon, subLat] = geom.coordinates;
          const distKm = haversineKm(Number(subLat), Number(subLon), regLat, regLon);
          const maxRadiusKm = Math.min(Number(a.radius_m || 2000), 20000) / 1000;
          if (distKm <= maxRadiusKm) {
            matchedUserIds.add(a.user_id);
          }
        }
      }
    }

    for (const r of validPush) {
      if (!options.broadcastAll && matchedUserIds && matchedUserIds.size > 0) {
        if (r.user_id && !matchedUserIds.has(r.user_id)) {
          continue;
        }
      }
      targets.push({
        id: r.id,
        subscription: {
          endpoint: r.endpoint,
          p256dh: r.p256dh,
          authKey: r.auth_key,
        },
      });
    }
  }

  let sent = 0;
  let failed = 0;
  const details: Array<{ id?: string; outcome: string; statusCode: number }> = [];

  for (const t of targets) {
    try {
      const res = await send({
        subscription: t.subscription,
        payload: alertPayload,
        ttlSeconds: 86400, // 24h PUSH_TTL_SECONDS
        vapid: options.vapid,
      });

      if (res.outcome === 'sent') {
        sent++;
      } else {
        failed++;
      }
      details.push({ id: t.id, outcome: res.outcome, statusCode: res.statusCode });
      options.onProgress?.({
        id: t.id,
        endpoint: t.subscription.endpoint,
        outcome: res.outcome,
        statusCode: res.statusCode,
      });
    } catch (err) {
      failed++;
      details.push({ id: t.id, outcome: 'failed', statusCode: 500 });
      options.onProgress?.({
        id: t.id,
        endpoint: t.subscription.endpoint,
        outcome: 'failed',
        statusCode: 500,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    sent,
    failed,
    subscribersCount: targets.length,
    alertPayload,
    details,
  };
}
