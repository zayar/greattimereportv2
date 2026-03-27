import { useMemo, useState } from "react";
import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";
import { isAxiosError } from "axios";
import { Navigate } from "react-router-dom";
import { useSession } from "./SessionProvider";

export function LoginPage() {
  const { firebaseUser, loading, signInWithGoogleCredential } = useSession();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtitle = useMemo(
    () =>
      "Production auth from gt.report, modern shell from GT_NewReport, and a cleaner path for both operational and BigQuery reporting.",
    [],
  );

  if (!loading && firebaseUser) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSuccess = async (response: CredentialResponse) => {
    if (!response.credential) {
      setError("Google sign-in was cancelled before a credential was returned.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await signInWithGoogleCredential(response.credential);
    } catch (loginError) {
      if (isAxiosError(loginError)) {
        const apiMessage =
          typeof loginError.response?.data?.error === "string"
            ? loginError.response.data.error
            : null;
        setError(apiMessage || loginError.message || "Unable to sign in.");
      } else {
        setError(loginError instanceof Error ? loginError.message : "Unable to sign in.");
      }
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-page__backdrop">
        <div className="backdrop-blob backdrop-blob-1" />
        <div className="backdrop-blob backdrop-blob-2" />
      </div>

      <section className="login-hero animate-fade-in-up">
        <span className="page-header__eyebrow">GreatTime Reporting</span>
        <h1>Report V2 for real clinic access, modern insight delivery, and safer analytics.</h1>
        <p>{subtitle}</p>

        <div className="hero-grid animate-fade-in-up-delay">
          <article className="hero-card">
            <div className="hero-card__icon">
              <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <strong>Secure login</strong>
            <span>Google credential exchange to Firebase custom token, exactly aligned with gt.report.</span>
          </article>
          <article className="hero-card">
            <div className="hero-card__icon">
              <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
              </svg>
            </div>
            <strong>Business-aware access</strong>
            <span>Clinic and business selectors derived from the logged-in user’s exact GT permissions.</span>
          </article>
          <article className="hero-card">
            <div className="hero-card__icon">
              <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z" />
              </svg>
            </div>
            <strong>Typed analytics</strong>
            <span>BigQuery stored server-side behind explicit report endpoints instead of raw public SQL.</span>
          </article>
        </div>
      </section>

      <section className="login-panel animate-fade-in-scale">
        <div className="login-panel__header">
          <span className="page-header__eyebrow">Sign in</span>
          <h2>Aesthetic Data Hub</h2>
          <p>Sign in with your GreatTime account. Sessions persist securely via Firebase custom tokens.</p>
        </div>

        <div className="login-panel__body">
          <div className="sso-wrapper">
            <GoogleLogin onSuccess={handleSuccess} onError={() => setError("Google sign-in failed.")} theme="filled_blue" shape="pill" size="large" />
          </div>

          {submitting ? (
            <div className="auth-status">
              <div className="auth-spinner"></div>
              <p className="muted-copy">Authenticating with Firebase...</p>
            </div>
          ) : null}
          {error ? <div className="inline-error"><svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>{error}</div> : null}
        </div>
      </section>
    </div>
  );
}
