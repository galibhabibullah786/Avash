-- docs/adr/ADR-016, docs/features/announcement-push.md — the AFTER INSERT
-- trigger that makes publishing an announcement actually push it.
--
-- THE BUG THIS FIXES. ADR-016 describes the fast path as "a Supabase
-- Database Webhook (AFTER INSERT ON announcements) received by
-- apps/notify/api/announcement-published.ts", and every piece of that
-- path was built — the receiver, the Inngest event, the delivery
-- function, the claim/lease — except the trigger that starts it.
-- `announcements` carried zero triggers, so a moderator publishing from
-- the UI inserted a row and nothing else happened: nothing called
-- apps/notify, no `announcement/published` event was ever emitted, and
-- delivery only occurred when someone invoked it by hand. The webhook
-- existed as a dashboard-configuration step nobody had performed, in an
-- environment where it could not be reviewed, tested, or recreated.
--
-- WHY THIS IS A MIGRATION AND NOT A DASHBOARD SETTING. A Database
-- Webhook created through Supabase's UI is a trigger like this one, but
-- it lives only in whichever project someone clicked it into. It cannot
-- be reviewed, does not exist in a fresh local stack (`pnpm
-- docker:supabase`), and silently does not exist in any environment that
-- was provisioned before or after the click. Declaring it here makes the
-- fast path a property of the schema, identical everywhere the
-- migrations run.
--
-- CONFIGURATION LIVES IN VAULT, NOT IN THIS FILE. The trigger needs the
-- apps/notify origin and the shared secret from
-- ANNOUNCEMENT_WEBHOOK_SECRET. Both are read at call time from
-- `vault.decrypted_secrets`, which is why this migration hardcodes
-- neither and is safe to commit. Supabase's own webhook UI writes the
-- target URL and its auth header as literal arguments baked into the
-- trigger definition, where the secret is readable from `pg_trigger` by
-- anyone who can read the catalogs — this avoids that.
--
-- Seed both, per environment, before expecting delivery (see
-- docs/features/announcement-push.md):
--   select vault.create_secret('https://<notify-host>', 'notify_origin');
--   select vault.create_secret('<shared secret>', 'announcement_webhook_secret');

-- Names the trigger reads from `vault.decrypted_secrets`. Declared as
-- constants in one place so the seeding instructions above, the doc, and
-- the function body cannot drift apart.
comment on extension pg_net is
  'HTTP client used by public.announcement_published_webhook() to reach apps/notify (ADR-016).';

create or replace function public.announcement_published_webhook()
returns trigger
  language plpgsql security definer
  set search_path = public, extensions, vault
as $$
declare
  v_origin text;
  v_secret text;
begin
  -- `security definer` is required, not incidental: `vault.decrypted_secrets`
  -- is readable only by the owner, and the caller here is whichever role
  -- inserted the announcement (the service role via apps/api today, but
  -- the trigger must not depend on that).
  select decrypted_secret into v_origin
  from vault.decrypted_secrets where name = 'notify_origin';

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'announcement_webhook_secret';

  -- FAIL SOFT, DELIBERATELY. An unconfigured or unreachable notification
  -- service must never make publishing an announcement fail: the insert
  -- is the durable, user-visible act, and delivery is a consequence of it
  -- that the system already knows how to recover. `pushed_at is null` on
  -- the row that was just committed is exactly what
  -- apps/notify/src/inngest/sweepUndelivered.ts scans for, so a skipped
  -- webhook costs at most one sweep interval
  -- (ANNOUNCEMENT_PUSH_SWEEP_CADENCE, 5 minutes) of latency rather than
  -- losing the announcement. Raising here instead would roll back the
  -- moderator's insert and report a failure for a message the platform
  -- was perfectly capable of delivering slightly later.
  if v_origin is null or v_secret is null then
    raise warning 'announcement_published_webhook: notify_origin and/or announcement_webhook_secret missing from vault — skipping the fast path for announcement %, leaving it for the sweep', new.id;
    return null;
  end if;

  -- net.http_post is asynchronous: it queues the request and returns a
  -- request id immediately, so this trigger never holds the inserting
  -- transaction open on a network round-trip to Vercel. Response status
  -- is therefore not observable from here — which is precisely why the
  -- sweep exists and why this function's return value is ignored.
  --
  -- Only the id is sent. apps/notify re-reads every other field from the
  -- database rather than trusting the payload (see the destructure and
  -- its comment in api/announcement-published.ts), so widening this body
  -- would create trust in transit that the receiver deliberately refuses
  -- to extend. `type` and `table` are fixed strings because
  -- `announcementWebhookBodySchema` requires those exact literals.
  perform net.http_post(
    url := v_origin || '/api/announcement-published',
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'announcements',
      'record', jsonb_build_object('id', new.id)
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-announcement-webhook-secret', v_secret
    ),
    timeout_milliseconds := 5000
  );

  return null;
end;
$$;

-- AFTER INSERT, so the row is committed and readable by the time
-- apps/notify calls back to re-read it. A BEFORE trigger would race the
-- receiver against its own transaction: the webhook could arrive, and
-- `deliverAnnouncement` could query for the id, before the insert became
-- visible — an intermittent "announcement not found" that would look like
-- a bug in the delivery service.
--
-- FOR EACH ROW because delivery is per-announcement; a statement-level
-- trigger would need to re-derive which rows the statement touched.
--
-- No UPDATE trigger on purpose: `pushed_at`/`push_claimed_at` are stamped
-- by the delivery pass itself, so firing on UPDATE would make every
-- successful delivery immediately re-trigger its own webhook.
drop trigger if exists announcements_published_webhook on public.announcements;
create trigger announcements_published_webhook
  after insert on public.announcements
  for each row
  execute function public.announcement_published_webhook();

-- The function is reached only through the trigger, never called
-- directly, and must not be exposed as a PostgREST RPC — a `security
-- definer` function that reads Vault and makes an outbound HTTP request
-- with a shared secret attached is not something any client role should
-- be able to invoke with an arbitrary argument.
revoke all on function public.announcement_published_webhook() from public, anon, authenticated;
