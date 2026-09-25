import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSignIn } from "./useSignIn";
import { PasswordInput } from "@/components/PasswordInput";

interface LocationState {
  from?: string;
}

export function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { status, error, signIn } = useSignIn();
  const navigate = useNavigate();
  const location = useLocation();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await signIn(email, password);
    if (result?.ok) {
      const state = location?.state as LocationState | null;
      navigate(state?.from ?? "/", { replace: true });
    }
  }

  return (
    <form
      className="form"
      onSubmit={handleSubmit}
      noValidate
      aria-label="Sign in"
    >
      <div className="field">
        <label className="field__label" htmlFor="signin-email">
          Email
        </label>
        <input
          id="signin-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="signin-password">
          Password
        </label>
        <PasswordInput
          id="signin-password"
          name="password"
          autoComplete="current-password"
          minLength={8}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <button
        className="button"
        type="submit"
        disabled={status === "submitting"}
      >
        {status === "submitting" ? "Signing in…" : "Sign in"}
      </button>
      <div
        className={error ? "alert alert--error" : undefined}
        role="alert"
        aria-live="assertive"
      >
        {error ?? ""}
      </div>
    </form>
  );
}
