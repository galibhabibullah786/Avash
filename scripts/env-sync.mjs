#!/usr/bin/env node
/**
 * Synchronizes environment variables across the monorepo for targeted environments.
 * Strictly enforces R2: Server secrets never reach apps/web/.env.
 *
 * Usage:
 *   pnpm env:sync:dev   # Distribute local Supabase CLI & dev credentials
 *   pnpm env:sync:prod  # Distribute production variables from root .env
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../..');
const webEnvPath = join(repoRoot, 'apps', 'web', '.env');
const apiVarsPath = join(repoRoot, 'apps', 'api', '.dev.vars');
const rootEnvPath = join(repoRoot, '.env');

const args = process.argv.slice(2);
const targetIndex = args.indexOf('--target');
const target = targetIndex !== -1 ? args[targetIndex + 1] : null;

if (!target || !['dev', 'prod'].includes(target)) {
  console.error('Error: Must specify a valid target via --target dev or --target prod.');
  process.exit(1);
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, 'utf8');
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    result[key] = val;
  }
  return result;
}

const rootEnv = parseEnvFile(rootEnvPath);

// Standard local Supabase CLI demo keys (ADR-014)
const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODMxOTQ0MDB9.local-anon-key-placeholder';
const LOCAL_SUPABASE_SERVICE_ROLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzE5NDQwMH0.local-service-role-key-placeholder';
const LOCAL_SUPABASE_JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';

console.log(`[env-sync] Synchronizing environment for target: ${target.toUpperCase()}`);

// 1. Prepare apps/web/.env (STRICTLY VITE_PUBLIC_ ONLY)
const webEnv = {};

if (target === 'dev') {
  webEnv['VITE_PUBLIC_API_BASE_URL'] = rootEnv['VITE_PUBLIC_API_BASE_URL'] || 'http://localhost:8787';
  webEnv['VITE_PUBLIC_SUPABASE_URL'] = rootEnv['VITE_PUBLIC_SUPABASE_URL'] || LOCAL_SUPABASE_URL;
  webEnv['VITE_PUBLIC_SUPABASE_ANON_KEY'] = rootEnv['VITE_PUBLIC_SUPABASE_ANON_KEY'] || LOCAL_SUPABASE_ANON;
  if (rootEnv['VITE_PUBLIC_TURNSTILE_SITE_KEY']) {
    webEnv['VITE_PUBLIC_TURNSTILE_SITE_KEY'] = rootEnv['VITE_PUBLIC_TURNSTILE_SITE_KEY'];
  }
  if (rootEnv['VITE_PUBLIC_VAPID_PUBLIC_KEY'] || rootEnv['VAPID_PUBLIC_KEY']) {
    webEnv['VITE_PUBLIC_VAPID_PUBLIC_KEY'] =
      rootEnv['VITE_PUBLIC_VAPID_PUBLIC_KEY'] || rootEnv['VAPID_PUBLIC_KEY'];
  }
} else {
  for (const [key, val] of Object.entries(rootEnv)) {
    if (key.startsWith('VITE_PUBLIC_')) {
      webEnv[key] = val;
    }
  }
}

// 2. Prepare apps/api/.dev.vars (SERVER SECRETS ONLY)
const apiVars = {};

if (target === 'dev') {
  apiVars['SUPABASE_URL'] = rootEnv['SUPABASE_URL'] || LOCAL_SUPABASE_URL;
  apiVars['SUPABASE_SERVICE_ROLE_KEY'] = rootEnv['SUPABASE_SERVICE_ROLE_KEY'] || LOCAL_SUPABASE_SERVICE_ROLE;
  apiVars['SUPABASE_JWT_SECRET'] = rootEnv['SUPABASE_JWT_SECRET'] || LOCAL_SUPABASE_JWT_SECRET;
  apiVars['ENVIRONMENT'] = 'development';
  if (rootEnv['GEMINI_API_KEY']) apiVars['GEMINI_API_KEY'] = rootEnv['GEMINI_API_KEY'];
  if (rootEnv['UPSTASH_REDIS_REST_URL']) apiVars['UPSTASH_REDIS_REST_URL'] = rootEnv['UPSTASH_REDIS_REST_URL'];
  if (rootEnv['UPSTASH_REDIS_REST_TOKEN']) apiVars['UPSTASH_REDIS_REST_TOKEN'] = rootEnv['UPSTASH_REDIS_REST_TOKEN'];
  if (rootEnv['TURNSTILE_SECRET_KEY']) apiVars['TURNSTILE_SECRET_KEY'] = rootEnv['TURNSTILE_SECRET_KEY'];
} else {
  const SERVER_SECRETS = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_JWT_SECRET',
    'GEMINI_API_KEY',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'TURNSTILE_SECRET_KEY',
    'ENVIRONMENT',
  ];
  for (const key of SERVER_SECRETS) {
    if (rootEnv[key]) {
      apiVars[key] = rootEnv[key];
    }
  }
}

// Security Check: Verify zero server secrets in webEnv
for (const key of Object.keys(webEnv)) {
  if (!key.startsWith('VITE_PUBLIC_')) {
    console.error(`FATAL: Forbidden non-public env key "${key}" detected for apps/web/.env (R2). Aborting.`);
    process.exit(1);
  }
}

// Write web env
const webContent =
  Object.entries(webEnv)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n';
writeFileSync(webEnvPath, webContent, 'utf8');
console.log(`[env-sync] Wrote ${Object.keys(webEnv).length} public variables to apps/web/.env`);

// Write api vars
const apiContent =
  Object.entries(apiVars)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n';
writeFileSync(apiVarsPath, apiContent, 'utf8');
console.log(`[env-sync] Wrote ${Object.keys(apiVars).length} server secrets to apps/api/.dev.vars`);
console.log('[env-sync] Environment synchronization complete.');
