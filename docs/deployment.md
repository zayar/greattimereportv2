# Deployment

`GT_V2Report` now includes:
- Firebase Hosting configuration for the frontend
- GitHub Actions CI on every PR and push to `main`
- GitHub Actions deployment to Firebase Hosting on `main`
- GitHub Actions deployment to Cloud Run on `main`

## Firebase Hosting

Configured files:
- [firebase.json](/Users/zayarmin/Development/GreatTime%20Platform/GT_V2Report/firebase.json)
- [.firebaserc](/Users/zayarmin/Development/GreatTime%20Platform/GT_V2Report/.firebaserc)
- [.github/workflows/deploy-hosting.yml](/Users/zayarmin/Development/GreatTime%20Platform/GT_V2Report/.github/workflows/deploy-hosting.yml)

Target:
- Firebase project: `aesthetics-441d8`
- Hosting site: `gtreport-v2`

Required GitHub secret:
- `FIREBASE_SERVICE_ACCOUNT_AESTHETICS_441D8`

Required GitHub repository variables for frontend build:
- `VITE_API_BASE_URL`
- `VITE_GOOGLE_CLIENT_ID`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`

## Cloud Run backend

Configured files:
- [backend/Dockerfile](/Users/zayarmin/Development/GreatTime%20Platform/GT_V2Report/backend/Dockerfile)
- [.dockerignore](/Users/zayarmin/Development/GreatTime%20Platform/GT_V2Report/.dockerignore)
- [.github/workflows/deploy-backend.yml](/Users/zayarmin/Development/GreatTime%20Platform/GT_V2Report/.github/workflows/deploy-backend.yml)

Required GitHub secret:
- `GCP_SERVICE_ACCOUNT_KEY`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `TELEGRAM_SCHEDULER_SECRET` for Cloud Scheduler triggered Telegram sends

`FIREBASE_SERVICE_ACCOUNT_JSON` can be the same JSON as `GCP_SERVICE_ACCOUNT_KEY` if that service account has both:
- the deployment roles listed below
- runtime access needed for Firebase Admin token verification and BigQuery reads

Required GitHub repository variables:
- `GCP_PROJECT_ID`
- `CLOUD_RUN_SERVICE`
- `CLOUD_RUN_REGION`
- `ARTIFACT_REGISTRY_REGION`
- `ARTIFACT_REGISTRY_REPOSITORY`
- `APICORE_GRAPHQL_URL`
- `CORS_ORIGIN`
- `BQ_PROJECT_ID`
- `BQ_DATASET`
- `BQ_LOCATION`
- `BQ_MAIN_DATA_VIEW`
- `BQ_MAIN_PAYMENT_VIEW`

Optional GitHub repository variables for Cloud Run runtime sizing:
- `CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT`
- `CLOUD_RUN_MEMORY`
- `CLOUD_RUN_CPU`
- `CLOUD_RUN_MIN_INSTANCES`
- `CLOUD_RUN_MAX_INSTANCES`

Optional GitHub repository variables for Telegram reliability tuning:
- `TELEGRAM_SCHEDULER_JOB_NAME`
- `TELEGRAM_API_TIMEOUT_MS`
- `TELEGRAM_SCHEDULER_BUSY_TIMEOUT_MS`
- `TELEGRAM_WEBHOOK_WATCHDOG_ENABLED`
- `TELEGRAM_WEBHOOK_WATCHDOG_INTERVAL_MS`
- `APICORE_REQUEST_TIMEOUT_MS`
- `FIREBASE_AUTH_REQUEST_TIMEOUT_MS`

Recommended Telegram scheduler setup:
- Set `APP_BASE_URL` to the public backend base URL and set the `TELEGRAM_SCHEDULER_SECRET` GitHub secret.
- The backend deploy workflow creates or updates a Cloud Scheduler HTTP job that calls `POST {APP_BASE_URL}/api/integrations/telegram/scheduler/run` every minute with header `x-telegram-scheduler-secret`.
- Optional variable: `TELEGRAM_SCHEDULER_JOB_NAME` (defaults to `gt-v2report-telegram-scheduler`).
- Keep `TELEGRAM_SCHEDULER_ENABLED=true`. The backend still runs a local catch-up tick, but Cloud Scheduler is the reliable production trigger when Cloud Run scales down or CPU is throttled between requests.
- Keep `TELEGRAM_WEBHOOK_WATCHDOG_ENABLED=true` unless intentionally disabled. The watchdog repairs the Telegram webhook if another process clears or replaces it.

Recommended service account roles for `GCP_SERVICE_ACCOUNT_KEY`:
- Cloud Run Admin
- Cloud Scheduler Admin
- Service Account User
- Cloud Build Editor
- Artifact Registry Writer

Recommended initial one-time setup in Google Cloud:
1. Create the Artifact Registry repository if it does not exist yet.
2. Create the Cloud Run service once or allow the workflow to create it on first deploy.
3. Add the required GitHub repo variables and secrets listed above.
4. Set `CORS_ORIGIN` to include all frontend origins separated by commas.

Example:
```text
http://localhost:5174,https://gtreport-v2.web.app,https://gtreport-v2.firebaseapp.com
```

The backend deploy workflow now writes the Cloud Run runtime env from GitHub configuration on every deploy, so you no longer need to manually maintain those backend env vars in the Cloud Run console.

## CI workflow

Configured file:
- [.github/workflows/ci.yml](/Users/zayarmin/Development/GreatTime%20Platform/GT_V2Report/.github/workflows/ci.yml)

This workflow uses placeholder frontend env values so type-checking and production builds can still run safely during CI without leaking production config.

Reference patterns:
- [Firebase Hosting GitHub integration](https://firebase.google.com/docs/hosting/github-integration)
- [google-github-actions/deploy-cloudrun](https://github.com/google-github-actions/deploy-cloudrun)
