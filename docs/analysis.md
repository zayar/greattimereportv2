# GT_V2Report Phase 1 Analysis

## Findings

### 1. `gt.report` auth flow

Source files:
- `gt.report/src/pages/login/login_form.tsx`
- `gt.report/src/pages/login/login.tsx`
- `gt.report/src/store/reducers/auth_reducer.ts`
- `gt.report/src/hooks/with_auth.tsx`
- `gt.apicore/src/resolvers/gauth_resolver.ts`
- `gt.apicore/src/auth/firebase.ts`

Actual flow:
1. The login screen uses Google Identity Services in the browser.
2. The Google credential is sent to the GraphQL `gauth` mutation.
3. `gt.apicore` verifies the Google token, looks up the GT user by email, loads the clinics attached to that user, and mints a Firebase custom token.
4. The frontend signs into Firebase with `signInWithCustomToken(...)`.
5. `onAuthStateChanged(...)` runs after Firebase session restore or login.
6. The frontend reads `authUser.getIdTokenResult()` and uses token claims as the app user object.
7. Redux `authState` is set to `loggedIn`, and encrypted `userInfo` is saved to local storage.

Observed token claim shape used by `gt.report`:
- `roles`
- `clinics` as an array of allowed clinic IDs
- `email`
- `userId` as the GT internal user id
- `photo`
- `name`

Important notes:
- `gt.report` is using the `gauth` mutation, not `gauth2`.
- `gauth` returns a custom token whose `clinics` claim is `string[]`.
- Route protection in `gt.report` depends on Redux auth state, but Firebase session persistence recreates Redux state on refresh.
- Logout clears local storage and calls Firebase `signOut()`.

### 2. `gt.report` clinic and business selection flow

Source files:
- `gt.report/src/layout/modern_sidebar.tsx`
- `gt.report/src/layout/top_bar.tsx`
- `gt.report/src/store/reducers/clinic_reducer.ts`
- `gt.report/src/hooks/with_clinic.tsx`
- `gt.report/src/graphql/clinic.ts`
- `gt.apicore/prisma/schema.prisma`

Actual flow:
1. After login, the user claim already contains allowed clinic IDs.
2. Sidebar code reads `authState.userInfo.clinics` and fetches full clinic records through GraphQL `clinics(where: { id: { in: [...] } })`.
3. The clinic reducer stores the fetched clinic list and picks the selected clinic.
4. `clinicInfo` is saved in encrypted local storage with:
   - `clinics`
   - `selected`
5. `with_clinic` reads the encrypted local copy first, then falls back to Redux.
6. Top bar clinic switching dispatches `setSelectedClinic(...)`, which updates Redux and encrypted local storage.
7. Most operational pages read `currentClinic.id` or `currentClinic.code` and feed that into GraphQL queries.

Domain mapping from `gt.apicore`:
- `Company` is the closest existing backend concept for “business”.
- `Clinic` belongs to a `Company`.
- A user can belong to many clinics through the many-to-many `User.clinics` relation.
- A user may also have optional legacy `clinic_id` and `company_id` fields, but clinic access in Google auth is built from the many-to-many relation.

Implications for V2:
- “Business selection” should be modeled as selecting a `Company`, then narrowing clinic choices to clinics under that company.
- The selected business must always be derived from the currently allowed clinic set, never from hardcoded fallback data.

### 3. `GT_NewReport` auth and clinic flow

Source files:
- `GT_NewReport/frontend/src/contexts/AuthContext.tsx`
- `GT_NewReport/frontend/src/contexts/ClinicContext.tsx`
- `GT_NewReport/frontend/src/components/Login.tsx`
- `GT_NewReport/backend/src/routes/index.ts`
- `GT_NewReport/backend/src/middleware/auth.middleware.ts`

What is good:
- Clear React context split between auth state and clinic state.
- Modern page shell and report layouts are much cleaner than `gt.report`.
- Firebase ID token is attached to API requests in `frontend/src/utils/apiClient.ts`.

Gaps and production problems:
- Login flow is different from `gt.report`: it uses Firebase email/password, not the GT Google-to-custom-token flow.
- Clinic access is fetched from Firestore `/api/user-clinics` using `allowedClinicCodes`, not from GT user/clinic relations in `gt.apicore`.
- `ClinicContext` contains large hardcoded fallback clinic data and falls back to it on API failure.
- Clinic selector also contains hardcoded logo fallback maps.
- This flow is not aligned with the actual GT auth and clinic model used by `gt.report`.

### 4. `GT_NewReport` BigQuery flow

Source files:
- `GT_NewReport/backend/src/index.ts`
- `GT_NewReport/frontend/src/components/Dashboard.tsx`
- `GT_NewReport/frontend/src/components/CustomerBehaviorReport.tsx`
- `GT_NewReport/frontend/src/components/ServiceBehaviorReport.tsx`
- `GT_NewReport/frontend/src/components/SalesBySalesPerson.tsx`
- `GT_NewReport/backend/src/routes/walletRoutes.ts`

What is good:
- The newer report set is clearly BigQuery-oriented.
- Several pages already define useful analytical report shapes and modern filter UX.
- There is a backend/frontend split that V2 should keep.

Main problems:
- `/api/query` accepts raw SQL from the frontend.
- Most frontend report pages interpolate clinic code and dates directly into SQL strings.
- Backend query routes are generally unauthenticated.
- `walletRoutes` falls back to mock data.
- `backend/src/services/bigquery.service.ts` is empty.
- `backend/src/routes/transaction.routes.ts` is empty.
- Some frontend requests still use hardcoded `http://localhost:3000/...`.
- The backend startup file with Firebase admin initialization is `new-index.ts`, while `index.ts` is doing most query work, so the runtime path is inconsistent.

Conclusion:
- The report ideas and visual patterns are reusable.
- The raw query architecture is not safe enough for production.

### 5. `gt.apicore` reusable backend and domain logic

Source files:
- `gt.apicore/prisma/schema.prisma`
- `gt.apicore/src/resolvers/gauth_resolver.ts`
- `gt.apicore/src/auth/firebase.ts`
- `gt.apicore/src/resolvers/client_resolver.ts`
- `gt.apicore/src/resolvers/booking_details_resolver.ts`
- `gt.apicore/src/resolvers/customer_info_resolver.ts`
- `gt.apicore/src/resolvers/customer_visits_resolver.ts`
- `gt.apicore/src/resolvers/booking_reports_resolver.ts`
- `gt.apicore/src/resolvers/payment_report_resolver.ts`
- `gt.apicore/src/resolvers/sales_by_sales_person_resolver.ts`

Reusable truths:
- Real GT auth is based on GT user records, Google token verification, and Firebase custom tokens.
- Real clinic access is derived from GT user-to-clinic relations in MySQL/Prisma, not Firestore fallback lists.
- Existing GT resolver vocabulary already matches needed V2 modules:
  - bookings and appointments
  - members/customers
  - payment report
  - sales by sales person
  - customer visits
  - service behavior

What to avoid copying directly:
- Hardcoded secrets currently present in reference repos.
- BigQuery helpers or resolvers that interpolate user input into SQL strings.
- The current permissive host-based GraphQL shielding assumptions.

## Reuse Plan

### Reuse directly or near-directly

From `gt.report`:
- Login sequence semantics:
  - Google credential -> GT auth exchange -> Firebase custom token sign-in
- Firebase session persistence behavior
- Token-claim-driven clinic access model
- Clinic fetch pattern from allowed clinic IDs
- Clinic selection persistence behavior
- Operational GraphQL query shapes where they are already stable

Candidate query/modules to lift into V2 first:
- `gt.report/src/graphql/clinic.ts`
- `gt.report/src/graphql/booking.ts` with `get_booking_details`
- `gt.report/src/graphql/order.ts` with `get_orders2` and `aggregateOrder`
- `gt.report/src/graphql/member.ts` with `getMembers`

From `GT_NewReport`:
- Overall visual direction for shell, cards, report layout, and navigation grouping
- Context-based separation idea for auth/access state
- Report page UX patterns:
  - filter bars
  - charts + detail tables
  - cleaner empty/loading states

From `gt.apicore`:
- Auth truth and claim generation
- Company/clinic/user relationships
- Existing analytical resolver logic and BigQuery query ideas
- Existing custom operational resolvers

### Rewrite intentionally

These should not be copied as-is:
- `GT_NewReport` fallback clinic data
- `GT_NewReport` raw `/api/query` execution model
- `GT_NewReport` mock wallet fallbacks
- `gt.report` Redux + encrypted-local-storage split state pattern
- `gt.report` legacy UI and layout code
- `gt.report` disabled Apollo auth header behavior

## Recommended GT_V2Report Architecture

### Frontend

Tech direction:
- React + TypeScript + Vite
- React Router
- Apollo Client for `gt.apicore` operational GraphQL calls
- REST client for GT_V2Report backend analytics/auth endpoints
- Context providers for:
  - session
  - access selection
  - page-level filters where needed

Suggested structure:

```text
frontend/src/
  app/
  api/
  components/
  features/
    auth/
    access/
    layout/
    dashboard/
    operational/
    analytics/
  lib/
  routes/
  styles/
  types/
```

Frontend responsibilities:
- run the real Google login flow
- sign in to Firebase with the returned custom token
- read claims from Firebase ID token
- load allowed clinics from `gt.apicore`
- derive businesses from those clinics
- persist validated business/clinic selection
- call:
  - `gt.apicore` for operational data
  - GT_V2Report backend for analytics endpoints

### Backend

Tech direction:
- Express + TypeScript
- Firebase Admin ID token verification
- BigQuery service/query layer
- thin auth exchange route to `gt.apicore`
- explicit report endpoints, not raw query execution

Suggested structure:

```text
backend/src/
  config/
  middleware/
  services/
    auth/
    apicore/
    bigquery/
    access/
    reports/
  routes/
  types/
  utils/
  server.ts
```

Backend responsibilities:
- exchange Google credential for the GT Firebase custom token by calling `gt.apicore`
- verify Firebase ID tokens for protected routes
- enforce clinic access using allowed clinic IDs from token claims
- expose typed analytics endpoints:
  - dashboard summary
  - customer behavior
  - service behavior
  - payment report
  - sales by seller
- keep BigQuery project, dataset, location, and credentials fully env-driven

### Access-control model

1. Login returns a Firebase custom token generated from GT user + clinic relations.
2. Frontend signs in to Firebase and reads allowed clinic IDs from token claims.
3. Frontend fetches full clinic records for those IDs from `gt.apicore`.
4. Businesses are derived from `clinic.company`.
5. Current business and current clinic are persisted locally but always revalidated against the allowed clinic list on load.
6. Backend analytics endpoints require both:
   - verified Firebase ID token
   - requested `clinicId` included in token claim `clinics`

### Operational vs analytical split

Operational modules:
- use `gt.apicore` GraphQL
- examples: appointments, sales, members

Analytical modules:
- use GT_V2Report backend
- examples: customer behavior, service behavior, payment analytics, seller analytics, dashboard KPIs

This keeps BigQuery logic out of the browser and avoids duplicating the transactional backend.

## Exact Reuse vs Rewrite Inventory

### Reuse

- `gt.report` login semantics and claim usage
- `gt.report` clinic fetch-by-claim-id behavior
- `gt.report` operational query intent and filters
- `GT_NewReport` page composition ideas and premium dashboard direction
- `gt.apicore` company/clinic/user domain model
- `gt.apicore` analytical query intent and report naming

### Rewrite

- auth/session state container
- clinic/business selection state container
- all new UI shell, navigation, report chrome, tables, and filters
- all BigQuery backend code
- all analytics APIs
- env/config loading
- README and setup flow

## Initial Migration Priority

Highest business-value modules to migrate first:
1. Login and protected shell
2. Business/clinic selector
3. Dashboard home
4. Appointments
5. Sales
6. Members
7. Customer behavior
8. Service behavior
9. Payment report

Reason:
- These cover the core “get in, pick the right business/clinic, see operational work, and view analytics” path.

## Risks

1. The reference repos contain hardcoded secrets and IDs. V2 must move all credentials to env files and never copy those literals into committed production code.
2. `gt.report` currently has a partially disabled Apollo auth-header path. V2 must attach Firebase ID tokens correctly for every authenticated request.
3. `GT_NewReport` uses a different Firebase project and Firestore-based clinic mapping that does not match GT production access logic. Reusing that path would create authorization drift.
4. Several existing `gt.apicore` analytical resolvers still build SQL with string interpolation. V2 should prefer parameterized BigQuery queries where possible.
5. Full parity with every legacy `gt.report` page is too large for the first cut. V2 should ship a strong shell plus the highest-value modules first, with a clear migration map for the rest.

## Decision

GT_V2Report should be a fresh monorepo with:
- a modern React frontend
- a secure Express analytics backend
- `gt.apicore` reused as the operational system of record
- no production fallback clinics
- no unrestricted raw SQL endpoint
- business/clinic access derived from the real GT auth claims and clinic relations
