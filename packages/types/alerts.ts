import { z } from 'zod';
import { appRoleSchema } from './api';

/** `ANNOUNCEMENT_TITLE_MAX_CHARS` (§14). */
export const ANNOUNCEMENT_TITLE_MAX_CHARS = 120;
/** `ANNOUNCEMENT_BODY_MAX_CHARS` (§14). */
export const ANNOUNCEMENT_BODY_MAX_CHARS = 1000;
/** `ANNOUNCEMENT_RADIUS_DEFAULT_M` (§14) — bounds 500–50,000. */
export const ANNOUNCEMENT_RADIUS_DEFAULT_M = 5000;
/** `ANNOUNCEMENT_MAX_ACTIVE_PER_AUTHOR` (§14). */
export const ANNOUNCEMENT_MAX_ACTIVE_PER_AUTHOR = 20;

export const announcementCreateSchema = z.object({
  title: z.string().trim().min(1).max(ANNOUNCEMENT_TITLE_MAX_CHARS),
  body: z.string().trim().min(1).max(ANNOUNCEMENT_BODY_MAX_CHARS),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusM: z.number().int().min(500).max(50_000).default(ANNOUNCEMENT_RADIUS_DEFAULT_M),
  // Empty array = every role. Non-empty = only these roles.
  targetRoles: z.array(appRoleSchema).max(4).default([]),
  expiresAt: z.string().datetime(),
});

export const announcementSchema = announcementCreateSchema.extend({
  id: z.string().uuid(),
  authorId: z.string().uuid().nullable(),
  // Both server-returned, read back from a Postgres `timestamptz` column
  // via PostgREST — that comes back with a `+00:00`-style offset, not the
  // literal `Z` suffix `.datetime()` requires, so this diverges from
  // announcementCreateSchema's stricter client-input `expiresAt`
  // (matches the `z.string()` convention every other server timestamp in
  // packages/types uses, e.g. api.ts's `createdAt`/`updatedAt`).
  createdAt: z.string(),
  expiresAt: z.string(),
});

export type AnnouncementCreate = z.infer<typeof announcementCreateSchema>;
export type Announcement = z.infer<typeof announcementSchema>;

/**
 * Bounds mirror `alert_subscriptions.radius_m`'s check constraint
 * (100–20000) EXACTLY. The zod schema and the DB constraint disagreeing
 * turns a 400 into a 500.
 */
export const alertSubscribeSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusM: z.number().int().min(100).max(20_000).default(2000),
  active: z.boolean().default(true),
});
export type AlertSubscribe = z.infer<typeof alertSubscribeSchema>;

export const pushSubscriptionRegisterSchema = z.object({
  endpoint: z.string().url().max(512),
  p256dh: z.string().min(1).max(256),
  authKey: z.string().min(1).max(256),
});
export type PushSubscriptionRegister = z.infer<typeof pushSubscriptionRegisterSchema>;

/** `ANNOUNCEMENT_PUSH_LEASE_SECONDS` (§14) — how long one delivery claim is held before the sweep may reclaim it. */
export const ANNOUNCEMENT_PUSH_LEASE_SECONDS = 300;
/** `ANNOUNCEMENT_PUSH_SWEEP_CADENCE` (§14) — safety-net scan cadence for undelivered announcements. */
export const ANNOUNCEMENT_PUSH_SWEEP_CADENCE = '*/5 * * * *';
/** `ANNOUNCEMENT_PUSH_CONCURRENCY` (§14) — simultaneous in-flight sends per delivery run. */
export const ANNOUNCEMENT_PUSH_CONCURRENCY = 10;
/**
 * `INNGEST_PLAN_CONCURRENCY_LIMIT` (§14) — the concurrent-run ceiling the
 * project's Inngest account actually permits. Not a tuning knob: it
 * mirrors an external plan limit, and exists as a named constant so the
 * function config below can be checked against it in a test instead of
 * the mismatch surfacing as a rejected app registration in production.
 */
export const INNGEST_PLAN_CONCURRENCY_LIMIT = 5;
/**
 * `ANNOUNCEMENT_PUSH_RUN_CONCURRENCY` (§14) — simultaneous Inngest
 * function RUNS, which is a different quantity from
 * `ANNOUNCEMENT_PUSH_CONCURRENCY` above (in-flight HTTP sends *within*
 * one run) and must not be collapsed back into it.
 *
 * The value is dictated by the Inngest plan, not by anything about push
 * delivery: registering a function that declares a higher limit than the
 * account allows makes Inngest reject the ENTIRE app registration, not
 * just clamp the one function. `PUT /api/inngest` answers
 * `400 {"message":"The function 'announcement-push-delivery' has higher
 * concurrency limits (10) than your plan limit of 5","modified":false}`
 * and no function in the app registers at all — so every announcement
 * silently goes undelivered while the deploy itself looks green. Raise
 * this only in the same change that raises the Inngest plan.
 */
export const ANNOUNCEMENT_PUSH_RUN_CONCURRENCY = 5;
/** `ANNOUNCEMENT_PUSH_BATCH_SIZE` (§14) — targets per Inngest step, keeping each invocation inside the function time limit. */
export const ANNOUNCEMENT_PUSH_BATCH_SIZE = 100;
/** `ANNOUNCEMENT_PUSH_MAX_PER_USER_PER_HOUR` (§14) — anti-spam ceiling per subscriber, applied per-user rather than as a global cadence. */
export const ANNOUNCEMENT_PUSH_MAX_PER_USER_PER_HOUR = 6;

/**
 * What `packages/push` sends and `apps/web/src/sw.js` receives.
 * NOTE: sw.js cannot import this file. It is compiled by
 * vite-plugin-pwa's `injectManifest`, but is deliberately kept
 * import-free so `apps/web/src/lib/sw.test.ts` can load its source into a
 * `vm` sandbox. Any change here must be mirrored into readPayload() in
 * the same commit.
 */
export const announcementPushPayloadSchema = z.object({
  kind: z.literal('announcement'),
  title: z.string().min(1).max(ANNOUNCEMENT_TITLE_MAX_CHARS),
  body: z.string().min(1).max(ANNOUNCEMENT_BODY_MAX_CHARS),
  announcementId: z.string().uuid(),
});
export type AnnouncementPushPayload = z.infer<typeof announcementPushPayloadSchema>;

/**
 * Supabase Database Webhook body. Only `record.id` is ever used —
 * everything else is re-read from the database (decision F, critique
 * §11 in temp/live-announcement-push.md).
 */
export const announcementWebhookBodySchema = z.object({
  type: z.literal('INSERT'),
  table: z.literal('announcements'),
  record: z.object({ id: z.string().uuid() }),
});
export type AnnouncementWebhookBody = z.infer<typeof announcementWebhookBodySchema>;

/** What one delivery pass reports back. */
export const announcementPushResultSchema = z.object({
  announcementId: z.string().uuid(),
  claimed: z.boolean(),
  targetCount: z.number().int().min(0),
  sent: z.number().int().min(0),
  gone: z.number().int().min(0), // 410s, rows deleted
  failed: z.number().int().min(0),
});
export type AnnouncementPushResult = z.infer<typeof announcementPushResultSchema>;
