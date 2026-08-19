#!/usr/bin/env node
// Prints the local container stack's actual state after a `docker
// compose ...` invocation: for each long-running service, its real
// exposed URL (read from `docker compose ps`'s Publishers, so it reflects
// a POSTGRES_PORT/WEB_PORT/API_PORT override rather than a hardcoded
// default) when it's up, or the exact command to start it when it isn't.
// Also reports whether the one-shot ml image has been built.
//
// Chained after every compose-invoking root script (`docker:db`,
// `docker:apps`, `docker:apps:down`, `docker:db:nuke`,
// `docker:ml:build`) so "what's running and how do I start the rest" is
// always the last thing printed, never something to go re-derive from
// `docker compose ps` by hand.
//
//   node scripts/docker-status.mjs
import { execFileSync } from 'node:child_process';

const SERVICES = [
  {
    service: 'db',
    label: 'Postgres + PostGIS',
    containerPort: 5432,
    defaultHostPort: 54322,
    urlFor: (host, port) => `postgresql://postgres:postgres@${host}:${port}/avash`,
    extra: 'shell: pnpm docker:db:psql',
    startCmd: 'pnpm docker:db',
  },
  {
    service: 'api',
    label: 'apps/api (Node)',
    containerPort: 8787,
    defaultHostPort: 8787,
    urlFor: (host, port) => `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/health`,
    startCmd: 'pnpm docker:apps:build && pnpm docker:apps',
  },
  {
    service: 'web',
    label: 'apps/web (nginx)',
    containerPort: 8080,
    defaultHostPort: 8080,
    urlFor: (host, port) => `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`,
    startCmd: 'pnpm docker:apps:build && pnpm docker:apps',
  },
  {
    service: 'notify',
    label: 'apps/notify (Node)',
    containerPort: 8788,
    defaultHostPort: 8788,
    urlFor: (host, port) => `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/health`,
    startCmd: 'pnpm docker:apps:build && pnpm docker:apps',
  },
];

function run(args, { quiet = false } = {}) {
  // `quiet` suppresses the child's stderr — used for probe commands (e.g.
  // `docker image inspect`) that are expected to fail as a normal outcome
  // and are already handled via try/catch; without this, execFileSync's
  // default stdio still lets the child's "No such image" land on our
  // stderr even though the exception itself is caught.
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'ignore'] : undefined,
  });
}

/** `docker compose ... ps --format json` emits one JSON object per line,
 * not a JSON array — parse defensively in case a future Compose version
 * switches to a single array instead. */
function parsePsOutput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
}

function getRunningServices() {
  try {
    // --profile apps also returns default-profile services (db) —
    // Compose always includes services with no profile regardless of
    // which profile is requested — so one call covers all three.
    const raw = run(['compose', '--profile', 'apps', 'ps', '--format', 'json'], { quiet: true });
    return parsePsOutput(raw);
  } catch (error) {
    console.error('Could not query the container stack — is the Docker daemon running?');
    console.error(error.message);
    process.exit(1);
  }
}

/**
 * Classifies a service into exactly one of four kinds, since each needs a
 * different suggestion — a service still inside its healthcheck's
 * `start_period` is not "down," and telling the user to run the start
 * command for it is actively wrong right after `docker compose up` (the
 * container was just created and is doing exactly what it should).
 */
function classify(entry) {
  if (!entry) return { kind: 'down', label: 'NOT RUNNING' };
  if (entry.State !== 'running') return { kind: 'down', label: `STOPPED (${entry.State})` };
  if (!entry.Health || entry.Health === '') return { kind: 'up', label: 'RUNNING' };
  if (entry.Health === 'healthy') return { kind: 'up', label: 'RUNNING (healthy)' };
  if (entry.Health === 'starting') {
    return { kind: 'starting', label: 'STARTING (health check pending)' };
  }
  return { kind: 'unhealthy', label: `RUNNING (${entry.Health})` };
}

function mlImageStatus() {
  try {
    run(['image', 'inspect', 'avash-ml:local'], { quiet: true });
    return { built: true };
  } catch {
    return { built: false };
  }
}

function padRight(text, width) {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function main() {
  const running = getRunningServices();
  const byService = new Map(running.map((entry) => [entry.Service, entry]));

  const rows = SERVICES.map((svc) => {
    const entry = byService.get(svc.service);
    const { kind, label: status } = classify(entry);

    if (kind === 'down') {
      return {
        service: svc.service,
        status,
        detail: `start: ${svc.startCmd}`,
        extra: null,
        kind,
      };
    }

    const publisher = (entry.Publishers ?? []).find((p) => p.TargetPort === svc.containerPort);
    const host = publisher?.URL || '127.0.0.1';
    const port = publisher?.PublishedPort ?? svc.defaultHostPort;
    const url = svc.urlFor(host, port);

    if (kind === 'unhealthy') {
      return {
        service: svc.service,
        status,
        detail: `${url} — check: docker compose logs ${svc.service}`,
        extra: null,
        kind,
      };
    }

    if (kind === 'starting') {
      return {
        service: svc.service,
        status,
        detail: `${url} (not ready yet)`,
        extra: null,
        kind,
      };
    }

    return {
      service: svc.service,
      status,
      detail: url,
      extra: svc.extra ?? null,
      kind,
    };
  });

  const ml = mlImageStatus();

  console.log('');
  console.log('=== Avash local stack ===');
  console.log('');

  const serviceWidth = Math.max(...rows.map((r) => r.service.length)) + 2;
  const statusWidth = Math.max(...rows.map((r) => r.status.length)) + 2;

  for (const row of rows) {
    console.log(
      `  ${padRight(row.service, serviceWidth)}${padRight(row.status, statusWidth)}${row.detail}`
    );
    if (row.extra) {
      console.log(`  ${' '.repeat(serviceWidth + statusWidth)}${row.extra}`);
    }
  }

  console.log('');
  if (ml.built) {
    console.log('  ml    built (avash-ml:local)   run: pnpm docker:ml <command>, e.g.');
    console.log('                                 pnpm docker:ml python ml/training/train.py');
  } else {
    console.log('  ml    not built                build: pnpm docker:ml:build');
  }

  console.log('');
  const upCount = rows.filter((r) => r.kind === 'up').length;
  const downCount = rows.filter((r) => r.kind === 'down').length;
  const startingCount = rows.filter((r) => r.kind === 'starting').length;
  const unhealthyCount = rows.filter((r) => r.kind === 'unhealthy').length;

  if (upCount === rows.length) {
    console.log(`All ${rows.length} services are up and healthy.`);
  } else {
    const notes = [];
    if (downCount > 0) {
      notes.push(`${downCount} not running — run the "start:" command(s) above`);
    }
    if (startingCount > 0) {
      notes.push(`${startingCount} still starting — re-run "pnpm docker:status" in a few seconds`);
    }
    if (unhealthyCount > 0) {
      notes.push(`${unhealthyCount} unhealthy — see the "check:" command(s) above`);
    }
    console.log(`${upCount} of ${rows.length} services up. ${notes.join('; ')}.`);
  }
  console.log('');
}

main();
