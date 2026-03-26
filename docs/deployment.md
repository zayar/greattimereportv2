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
- `VITE_APICORE_GRAPHQL_URL`
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

Required GitHub repository variables:
- `GCP_PROJECT_ID`
- `CLOUD_RUN_SERVICE`
- `CLOUD_RUN_REGION`
- `ARTIFACT_REGISTRY_REGION`
- `ARTIFACT_REGISTRY_REPOSITORY`

Recommended initial one-time setup in Google Cloud:
1. Create the Artifact Registry repository if it does not exist yet.
2. Create the Cloud Run service once or allow the workflow to create it on first deploy.
3. Configure backend runtime env vars on the Cloud Run service:
   - `APICORE_GRAPHQL_URL`
   - `FIREBASE_SERVICE_ACCOUNT_JSON`
   - `BQ_PROJECT_ID`
   - `BQ_DATASET`
   - `BQ_LOCATION`
   - `BQ_MAIN_DATA_VIEW`
   - `BQ_MAIN_PAYMENT_VIEW`
   - `CORS_ORIGIN`
4. Set `CORS_ORIGIN` to include all frontend origins separated by commas.

Example:
```text
http://localhost:5174,https://gtreport-v2.web.app,https://gtreport-v2.firebaseapp.com
```

## CI workflow

Configured file:
- [.github/workflows/ci.yml](/Users/zayarmin/Development/GreatTime%20Platform/GT_V2Report/.github/workflows/ci.yml)

This workflow uses placeholder frontend env values so type-checking and production builds can still run safely during CI without leaking production config.
