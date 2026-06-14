# Phase 2 GT Growth AI Premium Reports

## 1. Phase 2 Objective

Phase 2 turns the Phase 1 AI-ready report sections into a paid-feature foundation for `gt_growth_ai`.

The intended product behavior is:

- Basic reports remain free and keep returning normal appointment, payment, and weekly report numbers.
- GT Growth AI premium reports add AI insights, recommended actions, business opportunities, evidence, and concise AI summaries.
- All numbers used by GT Growth AI are deterministic and come from existing report calculations or BigQuery-backed evidence.
- No predictive AI, vector database, campaign automation, or Customer Relationship Agent changes are included in this phase.

## 2. Files Reviewed

Backend:

- `backend/src/services/telegram/report.service.ts`
- `backend/src/services/telegram/payment-report.service.ts`
- `backend/src/services/telegram/weekly-summary-report.service.ts`
- `backend/src/services/telegram/owner-ai-report.service.ts`
- `backend/src/services/telegram/delivery.service.ts`
- `backend/src/services/telegram/types.ts`
- `backend/src/services/reports/report-ai-insights.service.ts`
- `backend/src/services/reports/payment-report.service.ts`
- `backend/src/services/bigquery.service.ts`
- `backend/src/config/bigquery.ts`
- `backend/src/config/env.ts`
- `backend/src/routes/analytics.routes.ts`
- `backend/src/types/report-ai.ts`

Frontend:

- `frontend/src/components/ReportAiSections.tsx`
- `frontend/src/features/analytics/payment-report/PaymentReportPage.tsx`
- `frontend/src/types/domain.ts`
- `frontend/src/styles/global.css`

Access concepts searched:

- entitlement
- subscription
- billing
- feature flag
- premium
- plan
- permission
- role

No production entitlement or subscription module was found.

## 3. Feature Gate Implementation

Added a lightweight helper in `backend/src/services/feature-access.service.ts`.

Supported feature:

- `gt_growth_ai`

Configuration:

- `GT_GROWTH_AI_DEFAULT_ENABLED=false`
- `GT_GROWTH_AI_ENABLED_CLINIC_IDS=""`

Behavior:

- Backend checks `gt_growth_ai` before returning premium AI report sections.
- If enabled, the report may include `gtGrowthAi`.
- If disabled, the report includes a locked `premium` object and omits full AI insights/evidence/actions.
- Basic report data is not blocked.

TODO:

- Replace the environment-based helper with the future subscription or entitlement source when billing is ready.

## 4. Free vs Premium Behavior

Free/basic reports:

- Existing appointment report numbers
- Existing payment report numbers
- Existing weekly summary numbers
- Telegram basic report text
- Existing analytics payment report table and totals

Premium GT Growth AI sections:

- AI Insights
- Recommended Actions
- Business Opportunity
- AI Summary
- Evidence / "Why AI recommends this"
- Advanced explanations

Locked response shape includes:

- `premium.feature`
- `premium.enabled=false`
- `premium.title`
- `premium.message`
- `premium.upgradeMessage`
- optional safe teaser fields

The backend is the source of truth for access. Frontend rendering is display-only.

## 5. Daily Appointment Report Premium Behavior

Daily Appointment Report now checks `gt_growth_ai` before returning `gtGrowthAi`.

Premium content can include:

- Underbooked time slot insight
- No-show or cancellation risk insight
- Therapist load imbalance insight
- Rebooking opportunity insight
- Structured business opportunity
- Recommended actions

Telegram only appends `AI Actions` when the premium payload exists.

## 6. Daily Payment Report Revenue Evidence Additions

Added BigQuery-backed evidence helper in `backend/src/services/reports/gt-growth-ai-evidence.service.ts`.

Daily payment evidence includes where available:

- Revenue by service
- Top services by revenue
- Service revenue share
- Service count
- Average revenue per service
- Package sales revenue
- Package sales count
- Package revenue share
- Top packages by revenue
- Seller revenue
- Top seller, lowest seller, and revenue gap
- Payment method revenue and share
- Outstanding or partial payment evidence

The helper uses:

- Existing BigQuery table config from `analyticsTables.mainPaymentView`
- Parameterized queries
- `ClinicCode` filtering
- Date filtering

If optional fields are unavailable, the helper returns empty evidence plus a data-quality note instead of crashing the report.

## 7. Weekly Summary Package/Rebooking Evidence Additions

Weekly summary premium evidence now includes where available:

- Weekly package sales revenue
- Package sales count
- Package revenue share of weekly revenue
- Top packages by revenue
- Week-over-week package revenue change
- Top services by weekly revenue
- Completed customers this week
- Customers without future booking in the visible schedule
- Estimated rebooking opportunity value when average revenue is available

The weekly rebooking evidence is deterministic and based on visible `MainDataView` customer visit/future booking data. It does not predict churn or future value.

## 8. Frontend UI Changes

Updated `ReportAiSections` to support:

- AI Insights
- Recommended Actions
- Business Opportunity
- Evidence / "Why AI recommends this"
- AI Summary
- Locked premium state

Updated Payment Report page to render:

- Premium AI sections when `gtGrowthAi` is present
- Locked `Unlock GT Growth AI` state when `premium.enabled=false`

Labels used:

- "AI Insights"
- "Recommended Actions"
- "Business Opportunity"
- "Why AI recommends this"
- "Unlock GT Growth AI"
- "Upgrade to see AI recommendations"

No new appointment or weekly frontend report page was found in the current codebase, so frontend display work was applied to the existing analytics payment report UI and reusable component.

## 9. API Response Changes

Added optional/backward-compatible fields:

- `premium?: ReportPremiumAccess`
- `gtGrowthAi?: ReportAiPayload`

`ReportAiPayload.businessOpportunity` changed from plain text to a structured object:

- `id`
- `reportType`
- `title`
- `summary`
- `opportunityType`
- `estimatedValue`
- `estimatedValueLabel`
- `currency`
- `confidence`
- `evidence`
- `recommendedAction`

Existing basic report fields were not removed.

## 10. Security and Privacy Considerations

Implemented:

- Backend-enforced premium gate
- Parameterized BigQuery queries
- Clinic-scoped BigQuery filters
- Date-scoped BigQuery filters
- No hardcoded clinic IDs
- No customer private details in locked premium preview
- No secrets in code
- No LLM-generated financial totals

Locked state only exposes safe marketing copy and optional high-level teaser metadata.

## 11. Testing Completed

Automated coverage added/updated:

- `gt_growth_ai` access helper default/clinic-enabled behavior
- Daily payment service/package evidence builder
- Weekly package/rebooking evidence builder
- Appointment AI payload still handles empty data
- Payment AI payload does not invent package insight without evidence
- Payment AI payload generates revenue, package, and collection insights from deterministic facts
- Weekly AI payload generates package and rebooking insights from deterministic facts
- Telegram payment output keeps concise `AI Actions`

Commands run:

- `npm test` in `backend` passed: 27 tests
- `npm run build` in `backend` passed
- `npm run build` in `frontend` passed

Frontend build completed with the existing Vite chunk-size warning.

## 12. Known Limitations

- No production entitlement system was found, so access is temporarily environment-driven.
- Daily payment frontend AI payload is generated for single-day payment report ranges only.
- Weekly rebooking opportunity depends on visible future booking data in `MainDataView`; if future bookings are not present there, evidence may be limited.
- Refund/void/discount premium evidence remains nullable because the current report source does not consistently expose reliable refund/void semantics.
- Appointment and weekly frontend report pages were not found, so reusable UI support is ready but only the existing payment report page was wired.

## 13. Recommended Phase 3 Tasks

Suggested Phase 3 scope:

- Connect `gt_growth_ai` to the real subscription or entitlement source.
- Add appointment and weekly report frontend pages if those reports should be viewed outside Telegram.
- Add premium analytics around package conversion and rebooking follow-up outcomes.
- Add owner-facing upgrade CTA flow once billing exists.
- Add admin tooling to enable or disable `gt_growth_ai` per clinic.
- Add manual QA fixtures for premium and locked report states.
- Keep predictive AI, vector database, and campaign automation out of scope until the paid report foundation is stable.
