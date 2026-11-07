import { useState, type FormEvent } from "react";
import { supabase } from "../../lib/supabaseClient";
import { SubmitButton } from '@avash/ui';
import { PasswordInput } from '../../components/PasswordInput';

type SignUpStatus = "idle" | "submitting" | "success" | "error";

/**
 * Fixed, generic messages only — never `error.message` from Supabase.
 * The success message is shown on every non-throwing outcome, including
 * an already-registered email, so the form never discloses whether an
 * address is already in the system (docs/features/authentication.md).
 */
const SIGN_UP_GENERIC_ERROR =
  "এই মুহূর্তে অ্যাকাউন্ট তৈরি করা সম্ভব হচ্ছে না। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।";
const SIGN_UP_CONFIRMATION_MESSAGE =
  "আপনার অ্যাকাউন্ট নিশ্চিত করতে অনুগ্রহ করে ইমেইল ইনবক্স চেক করুন।";
export const SIGN_UP_DUPLICATE_EMAIL_WARNING =
  "এই ইমেইল দিয়ে ইতিমধ্যে একটি অ্যাকাউন্ট তৈরি করা হয়েছে। অনুগ্রহ করে লগইন করুন।";

export function SignUpForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<SignUpStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setError(null);
    setDuplicateWarning(false);

    try {
      const origin =
        typeof window !== "undefined" && window.location?.origin
          ? window.location.origin
          : "";
      const emailRedirectTo = origin
        ? `${origin}/login?confirmed=true`
        : undefined;

      const result = await supabase.auth.signUp({
        email,
        password,
        options: emailRedirectTo ? { emailRedirectTo } : undefined,
      });

      if (result?.error) {
        setStatus("error");
        setError(SIGN_UP_GENERIC_ERROR);
        return;
      }

      const user = result?.data?.user;
      if (
        user &&
        Array.isArray(user.identities) &&
        user.identities.length === 0
      ) {
        setStatus("idle");
        setDuplicateWarning(true);
        return;
      }

      setStatus("success");
    } catch {
      setStatus("error");
      setError(SIGN_UP_GENERIC_ERROR);
    }
  }

  if (status === "success") {
    return (
      <div className="alert" role="status" aria-live="polite">
        {SIGN_UP_CONFIRMATION_MESSAGE}
      </div>
    );
  }

  return (
    <form
      className="form"
      onSubmit={handleSubmit}
      noValidate
      aria-label="নিবন্ধন করুন"
    >
      <div className="field">
        <label className="field__label" htmlFor="signup-email">
          ইমেইল (Email)
        </label>
        <input
          id="signup-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(changeEvent) => {
            setEmail(changeEvent.target.value);
            if (duplicateWarning) {
              setDuplicateWarning(false);
            }
          }}
        />
        {duplicateWarning && (
          <div className="auth-warning" role="alert" aria-live="polite">
            {SIGN_UP_DUPLICATE_EMAIL_WARNING}
          </div>
        )}
      </div>
      <div className="field">
        <label className="field__label" htmlFor="signup-password">
          পাসওয়ার্ড (Password)
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

      <SubmitButton pending={status === 'submitting'} pendingLabel="অ্যাকাউন্ট তৈরি হচ্ছে…">
        নিবন্ধন করুন
      </SubmitButton>

      <div className={error ? 'alert alert--error' : undefined} role="alert" aria-live="assertive">
        {error ?? ''}
      </div>
    </form >
  );
}
