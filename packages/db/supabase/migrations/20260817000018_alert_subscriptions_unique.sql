-- docs/PROJECT_PLAN.md §6 amendment — POST /api/alerts/subscribe upserts on
-- (user_id, geom), but alert_subscriptions had no constraint backing that
-- ON CONFLICT target. Against a real Postgres instance the upsert would
-- fail with "there is no unique or exclusion constraint matching the ON
-- CONFLICT specification" — caught during integration, since the route's
-- test double doesn't enforce constraints the way real Postgres does.
alter table alert_subscriptions
  add constraint alert_subscriptions_user_geom_key unique (user_id, geom);
