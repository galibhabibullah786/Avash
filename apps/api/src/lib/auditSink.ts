import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditSink } from '@avash/security';

/**
 * Adapts the service-role Supabase client to `packages/security`'s
 * structural `AuditSink` (Appendix A.4) — that package must not gain a
 * `supabase-js` dependency, so the writer never sees a real client, only
 * this narrow `insert()` shape. Every write targets `audit_log`, which
 * carries no insert policy of its own (Appendix B); only the service-role
 * key used here bypasses RLS to reach it.
 */
export function createAuditSink(supabase: SupabaseClient): AuditSink {
  return {
    async insert(row) {
      const { error } = await supabase.from('audit_log').insert(row);
      return { error };
    },
  };
}
