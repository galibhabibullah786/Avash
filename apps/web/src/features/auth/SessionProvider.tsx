import { useEffect, useState, type ReactNode } from 'react';
import { resolveAppRole } from '@avash/security/roles';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabaseClient';
import { SessionContext, initialSessionValue, type SessionContextValue } from './useSession';

// Header.tsx (Phase-0-owned) imports useSession from this module — keep
// re-exporting it here rather than moving callers over to useSession.ts.
export { useSession } from './useSession';
export type { SessionContextValue, SessionStatus } from './useSession';

/**
 * Every access into `session`/`user`/`app_metadata` is optional-chained
 * (R4 #2) — the session object comes from a token this app does not fully
 * control, and a malformed or partial shape must resolve to "anonymous",
 * never throw.
 */
function deriveSessionState(session: Session | null | undefined): SessionContextValue {
  const supaUser = session?.user;
  if (!supaUser?.id) {
    return { ...initialSessionValue, status: 'anonymous' };
  }

  return {
    session: session ?? null,
    user: { id: supaUser.id, email: supaUser?.email ?? null },
    // Authenticated with no (or an unrecognized) role claim is a citizen,
    // not "role unknown" — `role` stays null only for the anonymous branch
    // above, so a null role never has to be interpreted twice.
    role: resolveAppRole(supaUser),
    accessToken: session?.access_token ?? null,
    status: 'authenticated',
  };
}

/**
 * Reads the current session via `supabase.auth.getSession()` and stays in
 * sync via `onAuthStateChange`. `status` stays `loading` until the initial
 * `getSession()` settles, so `ProtectedRoute` never has to guess.
 *
 * This is a subscription to an external client's auth state, not a
 * server-data fetch — it deliberately does not go through TanStack Query
 * (docs/standards/frontend.md's "no useEffect-based data fetching" rule
 * targets `apps/api` reads, not the Supabase auth client's own listener).
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<SessionContextValue>(initialSessionValue);

  useEffect(() => {
    let active = true;

    supabase.auth
      .getSession()
      .then((result) => {
        if (!active) return;
        setValue(deriveSessionState(result?.data?.session));
      })
      .catch(() => {
        if (active) setValue({ ...initialSessionValue, status: 'anonymous' });
      });

    const subscription = supabase.auth.onAuthStateChange((_event, session) => {
      setValue(deriveSessionState(session));
    });

    return () => {
      active = false;
      subscription?.data?.subscription?.unsubscribe();
    };
  }, []);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
