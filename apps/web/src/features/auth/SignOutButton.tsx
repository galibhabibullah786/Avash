import { useCallback, useState } from 'react';
import { useSignOut } from './useSignOut';
import { useSession } from './SessionProvider';
import { SubmitButton } from '../../components/SubmitButton';

/** Fixed, generic message only — never `useSignOut()`'s own `error` string, and never a raw rejection. */
export const SIGN_OUT_GENERIC_ERROR = 'Unable to sign out. Please try again.';

/**
 * The header's sign-out control (feature 7). Renders only for an
 * authenticated visitor — `Header.tsx`'s signed-out branch already shows
 * "Sign in" instead. Consumes the existing `useSignOut()` hook as-is;
 * this component owns only the pending/error presentation around it.
 */
export function SignOutButton() {
  const { status } = useSession();
  const { signOut } = useSignOut();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignOut = useCallback(async () => {
    setPending(true);
    setError(null);
    const result = await signOut?.();
    setPending(false);
    if (!result?.ok) {
      setError(SIGN_OUT_GENERIC_ERROR);
    }
  }, [signOut]);

  if (status !== 'authenticated') {
    return null;
  }

  return (
    <form
      className="navbar__signout"
      onSubmit={(event) => {
        event?.preventDefault?.();
        void handleSignOut();
      }}
      data-testid="sign-out-form"
    >
      <SubmitButton pending={pending} pendingLabel="Signing out…" className="button--secondary" data-testid="sign-out-button">
        Sign out
      </SubmitButton>
      {error ? (
        <p className="field__error" data-testid="sign-out-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
