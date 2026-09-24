/**
 * Vercel Node.js Function entry point for Inngest's serve endpoint
 * (function registration + invocation) — the production counterpart of
 * `server/node-server.ts`'s `/api/inngest` route, which only exists for
 * the local Docker container. Without this file `/api/inngest` 404s on
 * Vercel, `deploy-notify.yml`'s Inngest-sync step and post-deploy smoke
 * test both fail, and Inngest never invokes either function in
 * production regardless of how the deploy itself went.
 */
import { serve } from 'inngest/node';
import { inngest } from '../src/inngest/client';
import { deliverAnnouncementFn } from '../src/inngest/deliverAnnouncement';
import { sweepUndeliveredFn } from '../src/inngest/sweepUndelivered';

export default serve({
  client: inngest,
  functions: [deliverAnnouncementFn, sweepUndeliveredFn],
});
