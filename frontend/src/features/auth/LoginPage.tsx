import { useMemo, useState } from "react";
import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";
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
      setError(loginError instanceof Error ? loginError.message : "Unable to sign in.");
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-page__backdrop" />

      <section className="login-hero">
        <span className="page-header__eyebrow">GreatTime Reporting</span>
        <h1>Report V2 for real clinic access, modern insight delivery, and safer analytics.</h1>
        <p>{subtitle}</p>

        <div className="hero-grid">
          <article className="hero-card">
            <strong>Secure login</strong>
            <span>Google credential exchange to Firebase custom token, exactly aligned with gt.report.</span>
          </article>
          <article className="hero-card">
            <strong>Business-aware access</strong>
            <span>Clinic and business selectors are derived from the logged-in user’s actual GT permissions.</span>
          </article>
          <article className="hero-card">
            <strong>Typed analytics</strong>
            <span>BigQuery stays server-side behind explicit report endpoints instead of raw public SQL execution.</span>
          </article>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-panel__header">
          <span className="page-header__eyebrow">Sign in</span>
          <h2>Use your GreatTime Google account</h2>
          <p>Sessions persist through Firebase, and clinic access is loaded from GT claims after sign-in.</p>
        </div>

        <div className="login-panel__body">
          <GoogleLogin onSuccess={handleSuccess} onError={() => setError("Google sign-in failed.")} />

          {submitting ? <p className="muted-copy">Finishing Firebase custom-token sign-in...</p> : null}
          {error ? <div className="inline-error">{error}</div> : null}
        </div>
      </section>
    </div>
  );
}

