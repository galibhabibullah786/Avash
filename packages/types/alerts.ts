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
  createdAt: z.string().datetime(),
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
