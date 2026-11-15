// Drives the Supabase CLI's containerized local stack (ADR-014) from the
// repo root, so contributors never have to know that the CLI's workdir is
// `packages/db`.
//
//   pnpm docker:supabase          start, then print the env values to copy
//   pnpm docker:supabase:stop     stop the containers, keep the data volume
//   pnpm docker:supabase:nuke     stop and DELETE the local data
//   pnpm docker:supabase:status   keys + ports, without starting anything
//
// The CLI is invoked through this package's pinned devDependency (`pnpm
// --filter @avash/db exec supabase`), never a globally installed binary —
// a per-machine CLI version is exactly the drift ADR-014 warns about.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const dbPackageDir = path.join(repoRoot, 'packages', 'db');

const command = process.argv[2] ?? 'start';

/** `supabase` resolved from packages/db's devDependencies, run in its own workdir. */
function supabase(args, options = {}) {
  return execFileSync('pnpm', ['--filter', '@avash/db', 'exec', 'supabase', ...args], {
    cwd: dbPackageDir,
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    shell: process.platform === 'win32',
    encoding: 'utf8',
  });
}

function printEnvGuidance(statusOutput) {
  const find = (label) => {
    const match = statusOutput?.match?.(new RegExp(`${label}:\\s*(\\S+)`));
    return match?.[1] ?? '<run: pnpm docker:supabase:status>';
  };

  const apiUrl = find('API URL');
  const anonKey = find('anon key');
  const serviceKey = find('service_role key');
  const jwtSecret = find('JWT secret');

  console.log(`
  Local Supabase stack is up (ADR-014). Point the apps at it:

  ── apps/web/.env ───────────────────────────────────────────────────
  VITE_PUBLIC_SUPABASE_URL=${apiUrl}
  VITE_PUBLIC_SUPABASE_ANON_KEY=${anonKey}

  ── apps/api/.dev.vars ──────────────────────────────────────────────
  SUPABASE_URL=${apiUrl}
  SUPABASE_SERVICE_ROLE_KEY=${serviceKey}
  SUPABASE_JWT_SECRET=${jwtSecret}

  ── repo-root .env (jobs, ml/, and the api container) ───────────────
  SUPABASE_URL=${apiUrl}
  SUPABASE_SERVICE_ROLE_KEY=${serviceKey}
  SUPABASE_JWT_SECRET=${jwtSecret}

  These keys are the CLI's fixed local demo keys — identical on every
  machine, not secrets, and worthless against anything but this stack.
  Keep your hosted values somewhere before overwriting them.

  Next:
    pnpm db:migrate           apply packages/db/supabase/migrations
    pnpm db:seed              regions, hospitals, historical cases
    pnpm role:grant -- --email you@example.com --role admin

  Verified Local Endpoints:
    Studio:   http://127.0.0.1:54323
    API URL:  ${apiUrl}
    Database: postgresql://postgres:postgres@127.0.0.1:54329/postgres
`);
}

try {
  if (command === 'start') {
    supabase(['start']);
    const status = supabase(['status'], { capture: true });
    printEnvGuidance(status);
  } else if (command === 'stop') {
    supabase(['stop']);
    console.log('\n  Stopped. Data volume kept — `pnpm docker:supabase` brings it back as it was.\n');
  } else if (command === 'nuke') {
    supabase(['stop', '--no-backup']);
    console.log('\n  Stopped and local data deleted. Next start is a clean database.\n');
  } else if (command === 'status') {
    const status = supabase(['status'], { capture: true });
    console.log(status);
    printEnvGuidance(status);
  } else {
    console.error(`unknown command "${command}" — one of: start, stop, nuke, status`);
    process.exitCode = 1;
  }
} catch (error) {
  // The CLI already printed the real diagnostic to stderr; adding the
  // most common cause is more use than re-printing its message.
  console.error(`
  The Supabase CLI command failed.

  Most common causes:
    • Docker Desktop is not running.
    • Ports 54321/54323/54324/54329 are in use by another stack.
    • First run is still pulling images (~3 GB) — retry once it finishes.

  ${error instanceof Error ? error.message : String(error)}
`);
  process.exitCode = 1;
}
