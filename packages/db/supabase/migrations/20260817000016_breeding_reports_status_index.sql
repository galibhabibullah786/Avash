-- Moderation queue pagination (docs/PROJECT_PLAN.md §6 amendment) added
-- `count: 'exact'` filtered by status and sorted by created_at. The
-- existing idx_breeding_pending only covers status = 'pending' — every
-- other status ('verified', 'rejected', 'resolved'), all reachable from
-- the moderation queue's own status filter, fell back to a full scan for
-- both the count and the sort, growing unbounded with moderated history.
--
-- A single composite index covers all four statuses' filter, count
-- (index-only scan), and sort in one structure. idx_breeding_pending is
-- left in place — redundant for 'pending' now, but removing an index
-- outside what this migration needs is unrelated scope.
create index if not exists idx_breeding_status_created
  on breeding_reports (status, created_at desc);
