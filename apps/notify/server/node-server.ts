/**
 * Node entry point for the apps/notify container image (ADR-012, ADR-016).
 *
 * Production runs on Vercel; this file exists only so the same delivery
 * logic can run in a portable container for local testing — same pattern
 * as apps/api/server/node-server.ts. It serves three routes over one
 * `http.Server`: the Supabase Database Webhook receiver, the Inngest
 * serve endpoint (function registration + invocation), and a bare
 * liveness check.
 */
import http from 'node:http';
import { serve as serveInngest, serveEndpoint } from 'inngest/node';
import { inngest } from '../src/inngest/client';
import { deliverAnnouncementFn } from '../src/inngest/deliverAnnouncement';
import { sweepUndeliveredFn } from '../src/inngest/sweepUndelivered';
import { handleAnnouncementPublishedWebhook } from '../api/announcement-published';

/** In-container port (`APP_CONTAINER_PORTS`, docs/PROJECT_PLAN.md §14). */
const DEFAULT_PORT = 8788;

/**
 * Deploy-time config read on startup. Missing here means every delivery
 * fails closed inside packages/push rather than the container refusing
 * to start — same tradeoff apps/api's node-server.ts documents for its
 * own required vars, restated here: an operator who never sees a startup
 * warning has no way to learn why announcements silently never arrive.
 */
const REQUIRED_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'ANNOUNCEMENT_WEBHOOK_SECRET',
] as const;

function warnAboutMissingVars(): void {
  const missing = REQUIRED_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        message: 'apps/notify starting with unset required environment variable(s) — every delivery will fail closed until these are set',
        variables: missing,
      }),
    );
  }
}

const inngestHandler = serveInngest({
  client: inngest,
  functions: [deliverAnnouncementFn, sweepUndeliveredFn],
});

const webhookHandler = serveEndpoint(handleAnnouncementPublishedWebhook);

function healthHandler(_req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok' }));
}

warnAboutMissingVars();

const port = Number(process.env.PORT ?? DEFAULT_PORT);

const server = http.createServer((req, res) => {
  const url = req?.url ?? '';

  if (url === '/health') {
    return healthHandler(req, res);
  }
  // Inngest's own router handles GET (introspection), PUT (registration),
  // and POST (function invocation) under this one path.
  if (url.startsWith('/api/inngest')) {
    return inngestHandler(req, res);
  }
  if (url === '/api/announcement-published' && req.method === 'POST') {
    return webhookHandler(req, res);
  }

  res.writeHead(404);
  res.end();
});

server.listen(port, '0.0.0.0', () => {
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'apps/notify listening on the Node runtime (ADR-012, ADR-016)',
      port,
    }),
  );
});
