import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SignInForm } from "../features/auth/SignInForm";
import { SignUpForm } from "../features/auth/SignUpForm";
import "../features/auth/auth.css";

type Mode = "sign-in" | "sign-up";

export default function Login() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [searchParams, setSearchParams] = useSearchParams();
  const [showConfirmedToast, setShowConfirmedToast] = useState(
    searchParams.get("confirmed") === "true"
  );

  function dismissToast() {
    setShowConfirmedToast(false);
    searchParams.delete("confirmed");
    setSearchParams(searchParams, { replace: true });
  }

  return (
    <main className="auth-page">
      <div className="auth-brand">
        <span className="navbar__mark">✦</span>
        <strong>আভাস</strong>
      </div>
      <h1>স্বাগতম</h1>
      <p className="auth-page__lede">
        একটি নিরাপদ ও সুস্থ সমাজের জন্য আপনার আগাম পূর্বাভাস প্ল্যাটফর্ম।
      </p>
      <div className="card">
        {showConfirmedToast && (
          <div className="auth-toast" role="status" aria-live="polite">
            <span>ইমেইল যাচাইকরণ সফলভাবে সম্পন্ন হয়েছে! আপনার অ্যাকাউন্টে লগইন করুন।</span>
            <button
              type="button"
              className="auth-toast__close"
              aria-label="বন্ধ করুন"
              onClick={dismissToast}
            >
              ×
            </button>
          </div>
        )}
        <div
          className="auth-toggle"
          role="tablist"
          aria-label="লগইন অথবা নিবন্ধন করুন"
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
            লগইন
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
            নিবন্ধন করুন
          </button>
        </div>

        {mode === "sign-in" ? <SignInForm /> : <SignUpForm />}
      </div>
    </main>
  );
}
