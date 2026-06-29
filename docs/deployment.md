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

Optional GitHub repository variables for frontend feature visibility:
- `VITE_AI_CONTROL_PANEL_ADMIN_EMAILS` controls who sees the AI Control Panel menu; default is `zayar@datafocus.cloud`

## Cloud Run backend

Configured files:
- [backend/Dockerfile](/Users/zayarmin/Development/GreatTime%20Platform/GT_V2Report/backend/Dockerfile)
- [.dockerignore](/Users/zayarmin/Development/GreatTime%20Platform/GT_V2Report/.dockerignore)
- [.github/workflows/deploy-backend.yml](/Users/zayarmin/Development/GreatTime%20Platform/GT_V2Report/.github/workflows/deploy-backend.yml)

Required GitHub secret:
- `GCP_SERVICE_ACCOUNT_KEY`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `TELEGRAM_SCHEDULER_SECRET` for Cloud Scheduler triggered Telegram sends
- `AGENT_LEARNING_SCHEDULER_SECRET` for Cloud Scheduler triggered Agent Hub learning ticks

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

Optional GitHub repository variables for GT Growth AI access:
- `GT_GROWTH_AI_DEFAULT_ENABLED` enables GT Growth AI for every clinic when set to `true`
- `GT_GROWTH_AI_ENABLED_CLINIC_IDS` enables GT Growth AI for a comma-separated set of clinic IDs
- `GT_GROWTH_AI_FEATURE_STORE_ENABLED` lets the AI Control Panel read and write per-clinic access in Firestore
- `GT_GROWTH_AI_ADMIN_EMAILS` controls who can use the AI Control Panel; default is `zayar@datafocus.cloud`

Optional GitHub repository variables for Cloud Run runtime sizing:
- `CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT`
- `CLOUD_RUN_MEMORY`
- `CLOUD_RUN_CPU`
- `CLOUD_RUN_MIN_INSTANCES`
- `CLOUD_RUN_MAX_INSTANCES`

Optional GitHub repository variables for Telegram reliability tuning:
- `TELEGRAM_SCHEDULER_JOB_NAME`
- `TELEGRAM_SCHEDULER_CRON` (defaults to `*/30 * * * *`)
- `TELEGRAM_SCHEDULER_TIME_ZONE` (defaults to `Etc/UTC`)
- `TELEGRAM_SCHEDULER_INTERVAL_MS` (defaults to `1800000`)
- `TELEGRAM_API_TIMEOUT_MS`
- `TELEGRAM_SCHEDULER_BUSY_TIMEOUT_MS`
- `TELEGRAM_WEBHOOK_WATCHDOG_ENABLED`
- `TELEGRAM_WEBHOOK_WATCHDOG_INTERVAL_MS`
- `APICORE_REQUEST_TIMEOUT_MS`
- `FIREBASE_AUTH_REQUEST_TIMEOUT_MS`

Optional GitHub repository variables for Telegram appointment/customer UX:
- `SHOW_FULL_CUSTOMER_PHONE` enables full phone display for authorized staff when set to `true`
- `MASK_PHONE_IN_GROUP_CHAT` keeps group chats masked by default; set to `false` only when group full-phone display is approved
- `APPOINTMENT_BUTTON_PHONE_SUFFIX_DIGITS` controls duplicate-name button suffix length; default is `3`
- `MAX_APPOINTMENT_BUTTONS_PER_PAGE` controls appointment-name button pagination; default is `8`

Optional GitHub repository variables for Agent Hub scheduled learning:
- `AGENT_MEMORY_V2_ENABLED` (defaults to `false`)
- `AGENT_LEARNING_ENABLED` (defaults to `false`)
- `AGENT_LEARNING_DEFAULT_LOOKBACK_DAYS` (defaults to `365`)
- `AGENT_STALE_THRESHOLD_HOURS` (defaults to `24`)
- `AGENT_LEARNING_SCHEDULER_JOB_NAME` (defaults to `gt-v2report-agent-learning-scheduler`)
- `AGENT_LEARNING_SCHEDULER_CRON` (defaults to `*/15 * * * *`)
- `AGENT_LEARNING_SCHEDULER_TIME_ZONE` (defaults to `Asia/Yangon`)
- `AGENT_OPERATIONAL_SNAPSHOT_INTERVAL_MINUTES` (defaults to `15`; allowed values are `15`, `30`, `60`)
- `AGENT_LEARNING_MAX_CLINIC_CONCURRENCY` (defaults to `3`)

Recommended Agent Hub scheduler setup:
- Set `AGENT_MEMORY_V2_ENABLED=true` and `AGENT_LEARNING_ENABLED=true` only after `AGENT_LEARNING_SCHEDULER_SECRET` is configured.
- The backend deploy workflow creates or updates one Cloud Scheduler job that invokes `POST {APP_BASE_URL}/api/internal/agent-learning/run-all` with header `x-agent-learning-scheduler-secret`.
- Store enabled clinic schedule records in Firestore collection `gtAgentLearningSchedulesV1`.
- Each schedule record should include `clinicId`, verified `clinicCode`, `timezone`, `enabled`, `enabledJobTypes`, optional `cadenceOverrides`, `operatingDays`, `localOpeningTime`, `localClosingTime`, `operationalSnapshotIntervalMinutes`, and audit fields.
- Use `POST {APP_BASE_URL}/api/internal/agent-learning/tick` only for targeted testing or recovery. Send placeholder-safe JSON such as:

```json
{
  "clinicIds": ["CLINIC_ID"],
  "clinicCodesById": {
    "CLINIC_ID": "CLINIC_CODE"
  },
  "jobTypes": ["customer_profiles", "finance_daily_snapshot", "service_profiles", "practitioner_profiles", "appointment_daily_profile"]
}
```

- Recommended cost-aware cadence: every 15 minutes during clinic operating hours for `appointment_operational_snapshot`, hourly for `feedback_learning` and `recommendation_outcome_observer`, nightly for customer/service/practitioner/finance/appointment profiles, daily morning for `owner_insight_cards`, Monday morning for `weekly_business_review`, and Sunday early morning for `memory_maintenance`.
- The production scheduler must be external, such as Cloud Scheduler or private Cloud Run/OIDC. Do not rely on an in-process interval for Agent Hub learning.
- Scheduled jobs persist V2 artifacts in `gtAgentFactSnapshotsV2`, `gtAgentInsightCardsV2`, `gtAgentLearningWatermarksV2`, `gtAgentUserPreferencesV2`, `gtAgentClinicMemoriesV2`, and `gtAgentRecommendationOutcomesV2`.
- Current live appointment data does not expose `treatment_started_at`; see [APPOINTMENT_LIFECYCLE_DATA_CONTRACT.md](/Users/zayarmin/Development/GreatTime%20Platform/GT_V2Report/docs/APPOINTMENT_LIFECYCLE_DATA_CONTRACT.md).

Recommended Telegram scheduler setup:
- Set `APP_BASE_URL` to the public backend base URL and set the `TELEGRAM_SCHEDULER_SECRET` GitHub secret.
- The backend deploy workflow creates or updates a Cloud Scheduler HTTP job that calls `POST {APP_BASE_URL}/api/integrations/telegram/scheduler/run` every 30 minutes by default with header `x-telegram-scheduler-secret`.
- Optional variable: `TELEGRAM_SCHEDULER_JOB_NAME` (defaults to `gt-v2report-telegram-scheduler`).
- Optional variable: `TELEGRAM_SCHEDULER_CRON` controls the Cloud Scheduler interval. Use `*/15 * * * *` for every 15 minutes, `*/30 * * * *` for every 30 minutes, or `0 * * * *` for every 60 minutes.
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
