# GreatTime Agent Hub Implementation Plan

## Current Architecture And Reusable Services

- Backend is Express + TypeScript ESM under `backend/src`, with Firebase token auth and clinic access middleware already registered for analytics and AI routes.
- Existing AI route `/api/ai/customer-relationship-agent/*` already provides learned customer relationship profiles, follow-up copy, and feedback storage.
- Finance data can reuse `getSalesReport`, `getPaymentReport`, and `getBankingSummary`.
- Customer data can reuse learned customer profiles plus `getCustomerQuickView`, `getCustomerPortalOverview`, `getCustomerPortalPackages`, `getCustomerPortalBookings`, `getCustomerPortalPayments`, and `getCustomerPortalUsage`.
- Business data can reuse `getDashboardOverview`, `getServiceBehaviorReport`, `getServicePortalList`, `getServicePortalOverview`, `getServicePortalCustomers`, `getServicePortalPayments`, `getTherapistPortalReport`, `getTherapistPortalOverview`, `getTherapistPortalCustomers`, `getTherapistPortalTreatments`, and `getDailyTreatmentReport`.
- Appointment live state can reuse `fetchApicoreBookingDetails` and a new fixed APICORE check-in query based on the existing frontend `GET_CHECKIN_OUT_DATA` fields.
- Frontend already has protected routing, AI language preferences, date utilities, reusable status views, data tables, panels, and a Customer Relationship Agent page.

## Proposed Files And Module Boundaries

- `backend/src/services/agent-hub/`
  - `types.ts`, `schemas.ts`, `supervisor.ts`, `intent-planner.ts`, `tool-registry.ts`, `tool-executor.ts`, `response-builder.ts`, `safety.ts`
  - `session.repository.ts`, `trace.repository.ts`, `feedback.repository.ts`, `learning.repository.ts`
  - `entity-context.ts`, `clinic-context.service.ts`, `appointment-lifecycle.ts`, `appointment-live.service.ts`, `learning-worker.ts`
  - `tools/finance.tools.ts`, `tools/customer.tools.ts`, `tools/business.tools.ts`, `tools/appointment.tools.ts`
- `backend/src/routes/agent-learning.routes.ts` for the protected scheduler tick endpoint.
- Extend `backend/src/routes/ai.routes.ts` with `/agent/chat`, `/agent/feedback`, and `/agent/session/:sessionId`.
- `frontend/src/features/ai/agent-hub/AgentHubPage.tsx` and new API/type additions.
- `docs/APPOINTMENT_LIFECYCLE_DATA_CONTRACT.md` for treatment-start limitations.

## Confirmed Data Fields

- Booking details: `bookingid`, `FromTime`, `ToTime`, `ServiceName`, `MemberName`, `MemberPhoneNumber`, `PractitionerName`, `ClinicName`, `ClinicCode`, `ClinicID`, `HelperName`, `status`, `member_note`.
- Check-in/out: `id`, `in_time`, `out_time`, `status`, `created_at`, `isUsePurchaseService`, `order_id`, service ID/name, practitioner ID/name, member name/phone/clinic members, helper, and order payment summary fields.
- Sales/payment: typed BigQuery fields exposed by existing report services, including invoice number, customer, member ID, seller, service/package, payment method/status, payment amount, and invoice totals.
- Customer profile/history: learned customer keys, masked phone, member ID, visits, package balances, purchases, lifetime spend, risk, segments, reasons, and source learning run.

## Missing Fields Or Contracts

- No confirmed `treatment_started_at` or appointment event stream is exposed in the current code. `CHECKIN` must map to `arrived_start_unknown`, not confirmed waiting or in-treatment.
- No fully confirmed clinic-code lookup endpoint was found for server-side verification, so the initial route must enforce authorized `clinicId`, require `clinicCode`, and reject live appointment rows whose returned `ClinicID` or `ClinicCode` conflict with the request.
- Some customer drill-down flows need exact customer phone/name from source rows because existing detail services accept customer identity rather than a single customer ID.

## Implementation Phases

- [x] Inspect current app, attached docs, and source services.
- [x] Add repository guidance and planning/lifecycle documentation.
- [x] Add backend Agent Hub contracts, deterministic supervisor/planner, lifecycle mapping, fixed tool registry, executor, and response builder.
- [x] Add read-only finance, customer relationship, business, and appointment tools using existing services.
- [x] Add Firestore-backed sessions, entity references, feedback, run traces, and learning run logs with best-effort writes.
- [x] Add user routes under `/api/ai/agent/*` and scheduler route under `/api/internal/agent-learning/tick`.
- [x] Add frontend typed API, route, navigation entry, and a usable shared chat page.
- [x] Add tests for routing, planner, lifecycle, tool allowlists, entity context, scheduler auth, response grounding, and frontend mapping.
- [ ] Run `npm ci`, `npm run build`, and `npm run test`.

## Risks And Open Assumptions

- Firestore indexes for scalable profile search may need deployment outside this code change; the new hub will use bounded queries and document the index need.
- Some APICORE fields may be nullable or schema-dependent. Live tools must return `partial` or `unavailable` instead of exposing raw GraphQL errors.
- GT Growth AI feature access is reused for the first release. Locked clinics receive a safe locked response from the route.
- Scheduled learning is implemented as an externally triggered endpoint, not an in-process timer.

## Exact Test Plan

- Backend unit tests:
  - supervisor auto-routing, explicit overrides, tie-breaking, Myanmar keywords;
  - planner date extraction, intents, and write-request denial;
  - appointment lifecycle normalization for known statuses and treatment-start limitations;
  - tool registry allowlist behavior and row limit enforcement;
  - entity context ordinal resolution and TTL handling;
  - response builder preserves tool metrics and source metadata.
- Backend route-style tests:
  - scheduler secret rejected/accepted through the worker auth helper;
  - feedback repository input shape and sanitized storage;
  - unavailable tool errors become sanitized `unavailable` sources.
- Frontend tests:
  - Agent Hub API request/response mapping;
  - source/status chip view model;
  - selected customer row creates exact entity context;
  - waiting/in-progress limitation renders as a warning.
