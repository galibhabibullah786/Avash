import { useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { SubmitButton } from '../../components/SubmitButton';
import { PasswordInput } from '../../components/PasswordInput';

type SignUpStatus = 'idle' | 'submitting' | 'success' | 'error';

/**
 * Fixed, generic messages only — never `error.message` from Supabase.
 * The success message is shown on every non-throwing outcome, including
 * an already-registered email, so the form never discloses whether an
 * address is already in the system (docs/features/authentication.md).
 */
const SIGN_UP_GENERIC_ERROR = 'Unable to create an account right now. Please try again.';
const SIGN_UP_CONFIRMATION_MESSAGE = 'Check your email to confirm your account.';

export function SignUpForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<SignUpStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('submitting');
    setError(null);

    try {
      const result = await supabase.auth.signUp({ email, password });
      if (result?.error) {
        setStatus('error');
        setError(SIGN_UP_GENERIC_ERROR);
        return;
      }
      setStatus('success');
    } catch {
      setStatus('error');
      setError(SIGN_UP_GENERIC_ERROR);
    }
  }

  if (status === 'success') {
    return (
      <div className="alert" role="status" aria-live="polite">
        {SIGN_UP_CONFIRMATION_MESSAGE}
      </div>
    );
  }

  const pending = status === 'submitting';

  return (
    <form className="form" onSubmit={handleSubmit} noValidate aria-label="Sign up">
      <fieldset className="form__fieldset" disabled={pending}>
        <div className="field">
          <label className="field__label" htmlFor="signup-email">
            Email
          </label>
          <input
            id="signup-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(changeEvent) => setEmail(changeEvent.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="signup-password">
            Password
          </label>
          <PasswordInput
            id="signup-password"
            name="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(changeEvent) => setPassword(changeEvent.target.value)}
          />
        </div>
      </fieldset>
      <SubmitButton pending={pending} pendingLabel="Creating account…">
        Sign up
      </SubmitButton>
      <div className={error ? 'alert alert--error' : undefined} role="alert" aria-live="assertive">
        {error ?? ''}
      </div>
    </form>
  );
}
