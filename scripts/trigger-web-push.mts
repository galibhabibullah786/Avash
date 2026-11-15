#!/usr/bin/env -S node --experimental-strip-types
/**
 * Custom CLI tool to trigger dengue risk Web Push notifications across dev and prod.
 * Utilizes the exact production push pipeline (@avash/push and RFC 8291 aes128gcm).
 *
 * Usage:
 *   # Trigger on local dev for Dhaka (default)
 *   pnpm tsx scripts/trigger-web-push.ts --target dev --region Dhaka
 *
 *   # Trigger on production for a specific region
 *   pnpm tsx scripts/trigger-web-push.ts --target prod --region Chittagong --level severe
 *
 *   # Dry-run inspection
 *   pnpm tsx scripts/trigger-web-push.ts --target dev --region Dhaka --dry-run
 *
 *   # Direct test send to a single browser endpoint
 *   pnpm tsx scripts/trigger-web-push.ts --target dev --direct-endpoint "https://..." --p256dh "..." --auth "..."
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { triggerRiskAlertPush, type WebPushVapidConfig } from '../packages/push/index.ts';

if (!globalThis.WebSocket) (globalThis as any).WebSocket = class DummyWebSocket {};

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');

function parseArgs(args: string[]) {
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        parsed[key] = args[++i];
      } else {
        parsed[key] = true;
      }
    }
  }
  return parsed;
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const result: Record<string, string> = {};
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    result[key.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
  return result;
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));

  const target = (argv.target as string) || (process.env.NODE_ENV === 'production' ? 'prod' : 'dev');
  const regionName = (argv.region as string) || 'Dhaka';
  const riskLevel = ((argv.level as string) || 'severe') as 'moderate' | 'high' | 'severe';
  const riskScore = argv.score ? parseFloat(argv.score as string) : 0.85;
  const horizonWeeks = argv.horizon ? parseInt(argv.horizon as string, 10) : 4;
  const dryRun = Boolean(argv['dry-run']);
  const broadcastAll = Boolean(argv.broadcast || argv.all);
  const isMock = Boolean(argv.mock);

  console.log(`\n=== Avash Web Push Alert Trigger [${target.toUpperCase()}] ===`);
  console.log(`📍 Region: ${regionName} | Level: ${riskLevel.toUpperCase()} | Horizon: ${horizonWeeks}w`);
  console.log(`🎯 Target: ${broadcastAll ? 'BROADCAST ALL' : 'GEOFENCED'} | Mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}\n`);

  const envFile = path.join(repoRoot, target === 'prod' && existsSync(path.join(repoRoot, '.env.prod')) ? '.env.prod' : '.env');

  const loadedEnv = parseEnvFile(envFile);
  const sysEnv = process.env;

  const supabaseUrl =
    (sysEnv.SUPABASE_URL || loadedEnv.SUPABASE_URL || (target === 'dev' ? 'http://127.0.0.1:54321' : ''))?.trim();
  const serviceKey =
    (sysEnv.SUPABASE_SERVICE_ROLE_KEY ||
      loadedEnv.SUPABASE_SERVICE_ROLE_KEY ||
      (target === 'dev'
        ? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzE5NDQwMH0.local-service-role-key-placeholder'
        : ''))?.trim();

  const vapidPublicKey = (sysEnv.VAPID_PUBLIC_KEY || sysEnv.VITE_PUBLIC_VAPID_PUBLIC_KEY || loadedEnv.VAPID_PUBLIC_KEY || loadedEnv.VITE_PUBLIC_VAPID_PUBLIC_KEY)?.trim();
  const vapidPrivateKey = (sysEnv.VAPID_PRIVATE_KEY || loadedEnv.VAPID_PRIVATE_KEY)?.trim();
  const vapidSubject = (sysEnv.AVASH_VAPID_SUBJECT || sysEnv.VAPID_SUBJECT || loadedEnv.AVASH_VAPID_SUBJECT || loadedEnv.VAPID_SUBJECT || 'mailto:alerts@avash.app')?.trim();

  if (isMock) {
    console.log(`🧪 Running MOCK simulation with synthetic subscription...`);
    const mockVapid: WebPushVapidConfig = {
      publicKey: vapidPublicKey || 'BHdpWR6UsY39u1BHWDwuEs4N6Z3yfQog7JoBmgE7aJA6jOkH9AoIgkyTqVlumbZmY0XMT4vt4Gh6AzIt6Q6akV8',
      privateKey: vapidPrivateKey || '73GBRnY9tCTG3wnSA0LJvmMP9qcJ8Hz8vwPg0SbcPqE',
      subject: vapidSubject,
    };
    const res = await triggerRiskAlertPush({
      vapid: mockVapid,
      regionName,
      riskLevel,
      riskScore,
      horizonWeeks,
      testSubscription: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-mock-device-token',
        p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9t0nPtT-lW_eW9z89QG8JymajShZ-1BM8CJH',
        authKey: 'tBHItJI5svbpez7KI4CCXg',
      },
      sendFn: async () => ({ outcome: 'sent', statusCode: 201 }),
    });
    console.log(`✅ [MOCK] Pipeline encrypted payload and formatted push request successfully.`);
    console.log(`📦 Payload:\n`, JSON.stringify(res.alertPayload, null, 2));
    return;
  }

  // Handle direct test endpoint if passed
  const directEndpoint = argv['direct-endpoint'] as string | undefined;
  const directP256dh = argv.p256dh as string | undefined;
  const directAuth = argv.auth as string | undefined;

  if (directEndpoint && directP256dh && directAuth) {
    console.log(`🎯 Sending direct push to specified test subscription: ${directEndpoint.slice(0, 45)}...`);
    if (!vapidPublicKey || !vapidPrivateKey) {
      console.error('❌ Error: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY required to sign push notification.');
      process.exitCode = 1;
      return;
    }

    const vapid: WebPushVapidConfig = {
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      subject: vapidSubject,
    };

    if (dryRun) {
      console.log('✅ DRY-RUN: Payload formatted successfully for direct test subscriber.');
      return;
    }

    const res = await triggerRiskAlertPush({
      vapid,
      regionName,
      riskLevel,
      riskScore,
      horizonWeeks,
      testSubscription: {
        endpoint: directEndpoint,
        p256dh: directP256dh,
        authKey: directAuth,
      },
      onProgress: (p) => {
        console.log(`📡 Push Service Response: HTTP ${p.statusCode} (${p.outcome.toUpperCase()})`);
      },
    });

    console.log(`\nDispatch Result:`, res);
    return;
  }

  if (!supabaseUrl || !serviceKey) {
    console.error(`❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for target ${target}.`);
    console.error(`Please configure them in your root .env or .env.${target}.`);
    process.exitCode = 1;
    return;
  }

  console.log(`🔍 Connecting to Supabase at: ${supabaseUrl}`);
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { createClient: () => undefined as any },
  });

  const { data: dbPush, error: pushErr } = await supabase.from('push_subscriptions').select('id, endpoint');
  const pushCount = dbPush?.length ?? 0;
  console.log(`📱 Registered Browser Push Subscriptions: ${pushCount}`);
  if (pushErr) console.warn(`   (Warning querying push_subscriptions: ${pushErr.message})`);

  const { data: dbAlerts } = await supabase.from('alert_subscriptions').select('id, user_id, active').eq('active', true);
  console.log(`📍 Active Geofence Alert Watches:         ${dbAlerts?.length ?? 0}`);

  if (pushCount === 0) {
    console.log(`\n⚠️  NO REGISTERED BROWSERS FOUND in database (${supabaseUrl}).`);
    console.log(`   To receive push notifications on your phone or laptop:`);
    console.log(`   1. Open Avash in your browser (e.g. http://localhost:8080 or your hosted URL).`);
    console.log(`   2. Sign in and open Alerts or Dashboard.`);
    console.log(`   3. Click "Enable push notifications".`);
    console.log(`   4. Re-run: pnpm push:trigger --broadcast\n`);
  }

  const vapid: WebPushVapidConfig = {
    publicKey: vapidPublicKey || 'demo-vapid-public-key',
    privateKey: vapidPrivateKey || 'demo-vapid-private-key',
    subject: vapidSubject,
  };

  if (dryRun) {
    const res = await triggerRiskAlertPush({
      supabase,
      vapid,
      regionName,
      riskLevel,
      riskScore,
      horizonWeeks,
      broadcastAll,
      sendFn: async () => ({ outcome: 'sent', statusCode: 200 }),
    });

    console.log(`✅ [DRY-RUN] Matched ${res.subscribersCount} subscribers for region ${regionName}.`);
    console.log(`📦 Alert Payload:\n`, JSON.stringify(res.alertPayload, null, 2));
    return;
  }

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.error(`❌ Error: VAPID keys not configured in environment. Cannot sign live push messages.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n🚀 Dispatching live Web Push notifications...`);
  const result = await triggerRiskAlertPush({
    supabase,
    vapid,
    regionName,
    riskLevel,
    riskScore,
    horizonWeeks,
    broadcastAll,
    onProgress: (p) => {
      const icon = p.outcome === 'sent' ? '✅' : '❌';
      console.log(`  ${icon} [${p.id || 'target'}] HTTP ${p.statusCode} (${p.outcome.toUpperCase()}) -> ${p.endpoint.slice(0, 48)}...`);
    },
  });

  console.log(`\n============================================================`);
  console.log(`📊 Dispatch Complete:`);
  console.log(`   - Matched Subscribers: ${result.subscribersCount}`);
  console.log(`   - Sent Successfully:   ${result.sent}`);
  console.log(`   - Failed / Rejected:   ${result.failed}`);
  console.log(`============================================================\n`);
}

main().catch((err) => {
  console.error('trigger-web-push error:', err);
  process.exitCode = 1;
});
