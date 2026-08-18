import { Inngest } from 'inngest';

/**
 * Shared Inngest client for apps/notify (ADR-016). `INNGEST_EVENT_KEY` /
 * `INNGEST_SIGNING_KEY` are read implicitly by the SDK from
 * `process.env` — see docs/security/secrets-matrix.md, set as GitHub
 * Actions secrets + the Vercel dashboard, not present in any local `.env`
 * for this app yet.
 */
export const inngest = new Inngest({ id: 'avash-notify' });
