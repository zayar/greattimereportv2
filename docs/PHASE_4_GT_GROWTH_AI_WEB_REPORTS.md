# Phase 4 GT Growth AI Web Reports

## Objective

Phase 4 makes GT Growth AI visible in the web app for the reports that previously had premium AI behavior mainly through Telegram:

- Daily Appointment Report
- Weekly Summary Report

Daily Payment Report already renders GT Growth AI sections in the Sales Details web report.

## What Changed

New protected analytics endpoints:

- `GET /api/analytics/appointment-report`
- `GET /api/analytics/weekly-summary-report`

New frontend pages:

- `/analytics/appointment-report`
- `/analytics/weekly-summary-report`

Navigation now includes these reports under `GT Growth AI`.

## Free vs Premium Behavior

Basic report metrics remain available to clinics with normal report access.

When `gt_growth_ai` is disabled:

- Basic numbers render.
- The locked GT Growth AI card renders from the backend `premium` object.
- AI insight evidence, next actions, and business opportunities are not exposed.

When `gt_growth_ai` is enabled:

- The backend returns `gtGrowthAi`.
- The frontend renders AI Insights, Recommended Actions, Business Opportunity, and evidence using the shared `ReportAiSections` component.

## Backend Notes

The web endpoints reuse the same deterministic builders used by Telegram:

- `buildTodayAppointmentReport`
- `buildWeeklySummaryReport`

Appointment report now supports an explicit `dateKey`, preserving existing Telegram today behavior.

Weekly summary now supports an explicit `weekStartDateKey`, preserving existing Telegram previous-completed-week behavior.

## Security

- Both endpoints require Firebase auth.
- Both endpoints use existing clinic access checks.
- Premium access is still enforced on the backend by `gt_growth_ai`.
- The frontend only displays the locked/unlocked state returned by the backend.

## Manual Testing

1. Deploy backend and frontend.
2. Open `GT Growth AI > Daily Appointment Report`.
3. Confirm basic appointment KPIs load for a selected date.
4. Confirm locked state appears when `gt_growth_ai` is disabled.
5. Enable GT Growth AI for the clinic in `Settings > Telegram`.
6. Reload Daily Appointment Report and confirm AI sections appear when data supports insights.
7. Open `GT Growth AI > Weekly Summary Report`.
8. Confirm weekly KPIs, package/rebooking evidence, and premium AI sections behave the same way.

## Limitations

- This phase does not add predictive AI.
- This phase does not add campaign automation.
- This phase does not modify Customer Relationship Agent logic.
- Weekly report week selection assumes the chosen date is the start of the report week.

## Recommended Next Step

Add a small GT Growth AI overview page that summarizes enabled clinics, latest report opportunities, and whether each report has enough evidence to produce premium recommendations.
