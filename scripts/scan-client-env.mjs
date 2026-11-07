#!/usr/bin/env node
// CI gate (docs/PROJECT_PLAN.md §7.1, R2): scans the BUILT apps/web/dist
// output — not just the source — for any import.meta.env.* / process.env.*
// reference whose key does not start with VITE_PUBLIC_, and for any literal
// occurrence of a known server-only secret variable name. This is defense
// in depth on top of the ESLint no-restricted-syntax rule
// (packages/config/eslint-config): the lint rule catches it in source, this
// step catches it in the artifact that actually ships.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const distDir = join('apps', 'web', 'dist');

// The full server-only inventory from docs/security/secrets-matrix.md
// (§7.1) — none of these names may ever appear in a client bundle.
const SERVER_ONLY_VAR_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWT_SECRET',
  'GEMINI_API_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'TURNSTILE_SECRET_KEY',
  'DATABASE_URL',
  'DATABASE_URL_LOCAL',
  'DATABASE_URL_HOSTED',
];

const ENV_REFERENCE_PATTERN = /(?:import\.meta\.env|process\.env)\.([A-Z0-9_]+)/g;

function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      out.push(...collectFiles(path));
    } else if (/\.(js|mjs|css|html)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

const files = collectFiles(distDir);
if (files.length === 0) {
  console.error(`No built assets found under ${distDir} — did the build run?`);
  process.exit(1);
}

let violations = [];

for (const file of files) {
  const contents = readFileSync(file, 'utf8');

  for (const match of contents.matchAll(ENV_REFERENCE_PATTERN)) {
    const key = match[1];
    if (!key.startsWith('VITE_PUBLIC_')) {
      violations.push(`${file}: references non-VITE_PUBLIC_ env var "${key}"`);
    }
  }

  for (const name of SERVER_ONLY_VAR_NAMES) {
    if (contents.includes(name)) {
      violations.push(`${file}: contains literal server-only variable name "${name}"`);
    }
  }
}

if (violations.length > 0) {
  console.error('FAIL: client bundle references non-public environment variables:');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
