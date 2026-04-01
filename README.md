# GT_V2Report

GT_V2Report is a fresh report workspace that combines:
- `gt.report` authentication and clinic access behavior
- `GT_NewReport` presentation direction and analytical report experience
- `gt.apicore` as the operational source of truth
- a new secure backend for BigQuery analytics endpoints

The Phase 1 analysis document is in [docs/analysis.md](/Users/zayarmin/Development/GreatTime%20Platform/GT_V2Report/docs/analysis.md).

## What is implemented

Frontend:
- Google sign-in screen using the real GT auth exchange flow
- Firebase custom-token session restore
- protected routes
- business and clinic selectors derived from actual allowed clinics
- modern premium shell with responsive sidebar and top bar
- dashboard overview
- operational pages:
  - appointments
  - sales
  - members
- analytical pages:
  - sales report
  - banking summary
  - customer behavior
  - service behavior
  - payment report
  - daily treatment
  - sales by seller

Backend:
- `/api/auth/google` auth exchange route
- Firebase ID-token verification middleware
- clinic access enforcement from token claims
- typed BigQuery analytics endpoints
- env-based BigQuery and Firebase admin configuration

## Reuse vs rewrite

Reused logic:
- `gt.report` Google credential -> `gauth` -> Firebase custom token flow
- `gt.report` claim-based clinic access model
- `gt.report` clinic fetch by allowed clinic IDs
- `gt.report` operational GraphQL query intent for appointments, sales, and members
- `gt.apicore` company/clinic/user domain model
- `gt.apicore` report semantics for payment, customer, service, and seller analytics

Rewritten:
- all UI shell and styling
- auth/session state container
- clinic/business selection state container
- backend analytics API layer
- BigQuery service layer
- setup/docs/env structure

## Project structure

```text
GT_V2Report/
  backend/
    src/
      config/
      middleware/
      routes/
      services/
      utils/
  docs/
    analysis.md
  frontend/
    src/
      api/
      components/
      features/
        access/
        analytics/
        auth/
        dashboard/
        layout/
        operational/
      lib/
      styles/
      types/
      utils/
```

## Setup

1. Install dependencies:

```bash
cd "/Users/zayarmin/Development/GreatTime Platform/GT_V2Report"
npm install
```

2. Copy env templates:

```bash
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env
```

3. Fill the env values.

Important:
- frontend Firebase config should point to the same Firebase project used by the `gt.report` custom-token flow
- backend Firebase admin credentials must be able to verify those tokens
- backend BigQuery credentials must be allowed to query the configured analytics dataset

4. Start the app:

```bash
npm run dev
```

Frontend:
- [http://localhost:5174](http://localhost:5174)

Backend:
- [http://localhost:5050/api/health](http://localhost:5050/api/health)

5. Production build:

```bash
npm run build
```

## Environment variables

Frontend:
- `VITE_API_BASE_URL`
- `VITE_GOOGLE_CLIENT_ID`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`

Backend:
- `PORT`
- `CORS_ORIGIN`
- `APICORE_GRAPHQL_URL`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `BQ_PROJECT_ID`
- `BQ_DATASET`
- `BQ_LOCATION`
- `BQ_MAIN_DATA_VIEW`
- `BQ_MAIN_PAYMENT_VIEW`

## How login works

1. The browser gets a Google credential from Google Identity Services.
2. The frontend posts that credential to `POST /api/auth/google`.
3. The backend forwards it to `gt.apicore` GraphQL `gauth`.
4. `gt.apicore` verifies the Google token, finds the GT user, loads allowed clinics, and returns a Firebase custom token.
5. The frontend signs into Firebase with `signInWithCustomToken(...)`.
6. On auth restore, the frontend reads Firebase token claims and uses those claims as the GT session source.

This intentionally follows `gt.report` semantics instead of `GT_NewReport` email/password login.

## How business and clinic selection works

1. Firebase token claims contain the allowed clinic IDs.
2. The frontend queries `gt.apicore` for those clinic records.
3. Clinics are grouped by `company_id` to derive the business selector.
4. The selected business and clinic are persisted in local storage.
5. On every reload, persisted values are revalidated against the currently allowed clinic list.
6. Backend analytics routes also check that the requested `clinicId` exists in the verified token claims.

There is no production fallback clinic list in this app.

## How BigQuery works

The browser never sends raw SQL.

Flow:
1. frontend calls typed analytics endpoints under `/api/analytics/*`
2. backend verifies Firebase ID token
3. backend verifies requested clinic access using token claims
4. backend runs predefined BigQuery queries with server-side parameters
5. backend returns typed JSON payloads for charts and tables

Implemented analytics endpoints:
- `/api/analytics/dashboard`
- `/api/analytics/sales-report`
- `/api/analytics/banking-summary`
- `/api/analytics/customer-behavior`
- `/api/analytics/service-behavior`
- `/api/analytics/payment-report`
- `/api/analytics/daily-treatment`
- `/api/analytics/sales-by-seller`

## Module map

Operational:
- Dashboard shell
- Appointments
- Sales
- Members

Analytical:
- Dashboard overview
- Sales report
- Banking summary
- Customer behavior
- Service behavior
- Payment report
- Daily treatment
- Sales by seller

## Pending work

Not yet migrated in this first cut:
- full parity for every legacy `gt.report` route
- richer role-based menu trimming
- more operational modules such as therapists, check-in/out, services, products, wallets, notifications, and logs
- server-side proxying for all operational GraphQL calls
- automated tests
- richer deployment environments beyond the first Firebase Hosting and Cloud Run pipeline

## Notes

- `GT_NewReport` fallback clinic data and raw `/api/query` execution were intentionally not brought forward.
- `gt.report` UI code was intentionally not copied; only the underlying auth/access semantics and selected operational query behavior were carried over.
- `gauth2` was intentionally not used because `gt.report` relies on the simpler `gauth` claim shape where `clinics` is an array of clinic IDs.

## Deployment

Deployment setup is documented in [docs/deployment.md](/Users/zayarmin/Development/GreatTime%20Platform/GT_V2Report/docs/deployment.md).

Included deployment files:
- [firebase.json](/Users/zayarmin/Development/GreatTime%20Platform/GT_V2Report/firebase.json)
- [.firebaserc](/Users/zayarmin/Development/GreatTime%20Platform/GT_V2Report/.firebaserc)
- [.github/workflows/ci.yml](/Users/zayarmin/Development/GreatTime%20Platform/GT_V2Report/.github/workflows/ci.yml)
- [.github/workflows/deploy-hosting.yml](/Users/zayarmin/Development/GreatTime%20Platform/GT_V2Report/.github/workflows/deploy-hosting.yml)
- [.github/workflows/deploy-backend.yml](/Users/zayarmin/Development/GreatTime%20Platform/GT_V2Report/.github/workflows/deploy-backend.yml)
- [backend/Dockerfile](/Users/zayarmin/Development/GreatTime%20Platform/GT_V2Report/backend/Dockerfile)
