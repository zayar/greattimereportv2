import { useMemo, useState } from "react";
import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";
import { isAxiosError } from "axios";
import { Navigate } from "react-router-dom";
import { useSession } from "./SessionProvider";

export function LoginPage() {
  const { firebaseUser, loading, signInWithGoogleCredential } = useSession();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

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

  const handleEmailLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // Dummy handler for email login UI
    setError("Email login is not yet configured. Please Use Google Sign-In.");
  };

  return (
    <div className="al-page">
      {/* Top Header */}
      <header className="al-header">
        <div className="al-brand">Aura Luxe</div>
        <nav className="al-nav">
          <a href="#">SUPPORT</a>
          <a href="#">CLINIC PORTAL</a>
        </nav>
      </header>

      <div className="al-content">
        {/* Left Column */}
        <div className="al-left">
          <div className="al-bg-shapes">
            <div className="al-shape al-shape-1" />
            <div className="al-shape al-shape-2" />
          </div>

          <div className="al-left-content">
            <h1 className="al-heading">
              Smarter Insights<br />for<br />Modern Aesthetic<br />Clinics
            </h1>
            <p className="al-subheading">
              Empower your business with clinic-level reporting, revenue tracking, and beautiful data visualization designed for the aesthetic professional.
            </p>

            <div className="al-feature-list">
              <div className="al-feature">
                <div className="al-feature-icon al-icon-orange">
                  <svg fill="currentColor" viewBox="0 0 24 24"><path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6h-6z"/></svg>
                </div>
                <div className="al-feature-text">
                  <strong>Revenue Growth</strong>
                  <span>Track performance patterns in real-time.</span>
                </div>
              </div>

              <div className="al-feature">
                <div className="al-feature-icon al-icon-teal">
                  <svg fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                </div>
                <div className="al-feature-text">
                  <strong>Patient Retention</strong>
                  <span>Analyze loyalty and lifetime patient value.</span>
                </div>
              </div>

              <div className="al-feature">
                <div className="al-feature-icon al-icon-purple">
                  <svg fill="currentColor" viewBox="0 0 24 24"><path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z"/></svg>
                </div>
                <div className="al-feature-text">
                  <strong>Treatment Analytics</strong>
                  <span>Understand which services drive your clinic.</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="al-right">
          <div className="al-login-wrapper">
            <div className="al-login-titles">
              <h2>GreatTime Report</h2>
              <p>Secure access for aesthetic professionals</p>
            </div>

            <div className="al-login-card">
              <div className="al-google-btn-wrapper">
                <GoogleLogin
                  onSuccess={handleSuccess}
                  onError={() => setError("Google sign-in failed.")}
                  theme="outline"
                  shape="pill"
                  size="large"
                  text="continue_with"
                  width="100%"
                />
              </div>

              <div className="al-divider">
                <span>OR LOGIN WITH EMAIL</span>
              </div>

              <form onSubmit={handleEmailLogin} className="al-email-form">
                <div className="al-field">
                  <label>CLINIC EMAIL</label>
                  <input
                    type="email"
                    placeholder="dr.smith@clinic.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div className="al-field">
                  <div className="al-label-row">
                    <label>PASSWORD</label>
                    <a href="#" className="al-forgot">Forgot?</a>
                  </div>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                {error && <div className="al-error">{error}</div>}
                
                <button type="submit" className="al-submit-btn" disabled={submitting}>
                  {submitting ? "Authenticating..." : "Enter Dashboard"}
                </button>
              </form>

              <div className="al-security-note">
                <svg fill="currentColor" viewBox="0 0 24 24" className="al-lock-icon"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/></svg>
                <p>
                  <strong>Clinic-level permissions active.</strong> Access is restricted to authorized medical personnel and administrators. All activities are encrypted and logged for compliance.
                </p>
              </div>
            </div>

            <div className="al-inquire">
              Don't have a dashboard yet? <a href="#">Inquire for Clinic Portal</a>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="al-footer">
        <div className="al-footer-left">
          © 2024 AURA LUXE SYSTEMS. ALL RIGHTS RESERVED.
        </div>
        <div className="al-footer-right">
          <a href="#">PRIVACY POLICY</a>
          <a href="#">TERMS OF SERVICE</a>
        </div>
      </footer>
    </div>
  );
}
