-- Idempotent sequence closure stub (ADR-014).
-- Bridges the migration sequence gap between 20260926000000 and 20260926000002
-- to guarantee monotonic version ordering and zero drift against hosted Supabase.
select 1;
