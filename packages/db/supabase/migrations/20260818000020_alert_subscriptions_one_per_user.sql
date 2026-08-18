-- One proximity-alert subscription per user, replacing the (user_id, geom)
-- pair added by 20260817000018_alert_subscriptions_unique.sql.
--
-- That constraint made the point itself part of the identity, so moving
-- your geofence created a SECOND subscription rather than moving the
-- existing one — the upsert's ON CONFLICT target never matched, since the
-- new geom differed from the old one. A user then quietly accumulated a
-- row per place they ever subscribed from, each still active and each
-- still matched by ml/serving/push_delivery.py, and the UI had no way to
-- retire any of them.
--
-- `user_id` alone as the conflict target makes re-subscribing an in-place
-- UPDATE of geom/radius/active, which is what "change my alert location"
-- has to mean when a user is only ever allowed one.

-- Collapse any user who already accumulated more than one row down to
-- their most recent, which is the one their last subscribe action
-- intended. Ordered by created_at then id so the choice is deterministic
-- even for rows written inside the same transaction (created_at defaults
-- to now(), which is transaction-scoped, not statement-scoped).
delete from alert_subscriptions a
using alert_subscriptions b
where a.user_id is not null
  and a.user_id = b.user_id
  and (a.created_at, a.id) < (b.created_at, b.id);

alter table alert_subscriptions
  drop constraint if exists alert_subscriptions_user_geom_key;

alter table alert_subscriptions
  add constraint alert_subscriptions_user_id_key unique (user_id);
