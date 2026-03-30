import { useEffect, useRef, useState } from "react";
import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";
import { isAxiosError } from "axios";
import { Navigate } from "react-router-dom";
import { useSession } from "./SessionProvider";

export function LoginPage() {
  const { firebaseUser, loading, signInWithGoogleCredential } = useSession();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buttonWrapperRef = useRef<HTMLDivElement | null>(null);
  const [googleButtonWidth, setGoogleButtonWidth] = useState(320);

  useEffect(() => {
    const wrapper = buttonWrapperRef.current;
    if (!wrapper) {
      return;
    }

    const updateWidth = () => {
      const nextWidth = Math.floor(wrapper.getBoundingClientRect().width);
      if (nextWidth > 0) {
        setGoogleButtonWidth(Math.max(220, Math.min(380, nextWidth)));
      }
    };

    updateWidth();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        updateWidth();
      });
      observer.observe(wrapper);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

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
    <div className="al-page">
      <header className="al-header">
        <div className="al-brand">Great Time App</div>
        <nav className="al-nav">
          <a href="#">SUPPORT</a>
          <a href="#">CLINIC PORTAL</a>
        </nav>
      </header>

      <div className="al-content">
        <div className="al-left">
          <div className="al-bg-shapes">
            <div className="al-shape al-shape-1" />
            <div className="al-shape al-shape-2" />
          </div>

          <div className="al-left-content">
            <span className="al-kicker">Great Time App Analytics</span>
            <h1 className="al-heading">
              A calmer analytics
              <br />
              workspace for
              <br />
              aesthetic clinics
            </h1>
            <p className="al-subheading">
              Open your clinic intelligence workspace with one secure Google sign-in. Revenue, customers, services, and operations stay connected in one premium reporting experience.
            </p>

            <div className="al-feature-list">
              <div className="al-feature">
                <div className="al-feature-icon al-icon-orange">
                  <svg fill="currentColor" viewBox="0 0 24 24"><path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6h-6z"/></svg>
                </div>
                <div className="al-feature-text">
                  <strong>Executive visibility</strong>
                  <span>Track revenue, growth, and clinic momentum in one place.</span>
                </div>
              </div>

              <div className="al-feature">
                <div className="al-feature-icon al-icon-teal">
                  <svg fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                </div>
                <div className="al-feature-text">
                  <strong>Customer and service intelligence</strong>
                  <span>Understand retention, demand, and performance without leaving the workspace.</span>
                </div>
              </div>

              <div className="al-feature">
                <div className="al-feature-icon al-icon-purple">
                  <svg fill="currentColor" viewBox="0 0 24 24"><path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z"/></svg>
                </div>
                <div className="al-feature-text">
                  <strong>Access by clinic permissions</strong>
                  <span>Authorized team members sign in with Google and land directly in the right clinic context.</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="al-right">
          <div className="al-login-wrapper">
            <div className="al-login-titles">
              <span className="al-login-eyebrow">Google sign-in only</span>
              <h2>Welcome to Great Time App</h2>
              <p>Use your authorized Google account to open the clinic analytics workspace.</p>
            </div>

            <div className="al-login-card">
              <div className="al-login-copy">
                <strong>One secure entry point for your clinic team</strong>
                <p>
                  Email and password login is not used here. Access is granted after Google verification and clinic-level permission checks.
                </p>
              </div>

              <div className="al-login-bullets">
                <div className="al-login-bullet">
                  <span>01</span>
                  <p>Sign in with your Google account</p>
                </div>
                <div className="al-login-bullet">
                  <span>02</span>
                  <p>We verify your clinic permissions</p>
                </div>
                <div className="al-login-bullet">
                  <span>03</span>
                  <p>You enter the reporting workspace immediately</p>
                </div>
              </div>

              <div className="al-google-btn-wrapper" ref={buttonWrapperRef}>
                <GoogleLogin
                  onSuccess={handleSuccess}
                  onError={() => setError("Google sign-in failed.")}
                  theme="outline"
                  shape="pill"
                  size="large"
                  text="continue_with"
                  width={String(googleButtonWidth)}
                />
              </div>

              {submitting ? <div className="al-auth-note">Verifying your access and opening the dashboard...</div> : null}
              {error ? <div className="al-error">{error}</div> : null}

              <div className="al-security-note">
                <svg fill="currentColor" viewBox="0 0 24 24" className="al-lock-icon"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/></svg>
                <p>
                  <strong>Clinic-level permissions active.</strong> Access is restricted to authorized medical personnel and administrators. All activities are encrypted and logged for compliance.
                </p>
              </div>
            </div>

            <div className="al-inquire">
              Need access for a clinic team? <a href="#">Contact Great Time App support</a>
            </div>
          </div>
        </div>
      </div>

      <footer className="al-footer">
        <div className="al-footer-left">
          © GREAT TIME APP. ALL RIGHTS RESERVED.
        </div>
        <div className="al-footer-right">
          <a href="#">PRIVACY POLICY</a>
          <a href="#">TERMS OF SERVICE</a>
        </div>
      </footer>
    </div>
  );
}
