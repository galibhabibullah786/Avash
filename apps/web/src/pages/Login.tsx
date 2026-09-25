import { useState } from "react";
import { SignInForm } from "../features/auth/SignInForm";
import { SignUpForm } from "../features/auth/SignUpForm";
import "../features/auth/auth.css";

type Mode = "sign-in" | "sign-up";

export default function Login() {
  const [mode, setMode] = useState<Mode>("sign-in");

  return (
    <main className="auth-page">
      <div className="auth-brand">
        <span className="navbar__mark">✦</span>
        <strong>আভাস</strong>
      </div>
      <h1>Welcome back</h1>
      <p className="auth-page__lede">
        Your early-warning dashboard for a safer, healthier community.
      </p>
      <div className="card">
        <div
          className="auth-toggle"
          role="tablist"
          aria-label="Sign in or sign up"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "sign-in"}
            className={
              mode === "sign-in" ? "button" : "button button--secondary"
            }
            onClick={() => setMode("sign-in")}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "sign-up"}
            className={
              mode === "sign-up" ? "button" : "button button--secondary"
            }
            onClick={() => setMode("sign-up")}
          >
            Sign up
          </button>
        </div>

        {mode === "sign-in" ? <SignInForm /> : <SignUpForm />}
      </div>
    </main>
  );
}
