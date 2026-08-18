/**
 * Supabase Database Webhook receiver — `AFTER INSERT ON announcements`.
 * Constant-time compares the shared-secret header, parses the body with
 * `announcementWebhookBodySchema`, and uses only `record.id` —
 * everything else is re-read from the database rather than trusted from
 * the payload (critique §11, temp/live-announcement-push.md). Emits the
 * `announcement/published` Inngest event and returns `202` with no body.
 * Implemented in A-T04.
 */
export async function handleAnnouncementPublishedWebhook(_request: Request): Promise<Response> {
  throw new Error('not implemented');
}
