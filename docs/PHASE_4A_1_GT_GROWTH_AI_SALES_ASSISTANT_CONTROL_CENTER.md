# Phase 4A.1 GT Growth AI Sales Assistant Control Center

## Objective

Make GT Growth AI easier for business owners to operate by adding clear Telegram report routing and configurable Sales Assistant rules while keeping all action generation deterministic.

## What Changed

- Added clinic-level Sales Assistant settings.
- Added safe owner condition interpretation into structured filters.
- Added a Telegram report routing matrix in settings.
- Changed Sales Assistant Telegram output to Myanmar by default.
- Limited default daily Sales Assistant actions to 15.
- Removed inactive VIP average spend from the exact estimated opportunity total.

## Report Routing

Telegram routing remains per linked target. Each target can receive its own combination of:

- Today Appointment Report
- Today Payment Report
- Weekly Summary Report
- AI Owner Report
- GT Growth AI Sales Assistant tasks
- GT Growth AI owner progress summary

The routing matrix shows which target receives which report. Editing still happens through the selected target panels so existing scheduling behavior remains backward compatible.

## Sales Assistant Settings

New settings are stored in `gt_growth_ai_sales_assistant_settings`.

Fields:

- `language`
- `maxTasksPerDay`
- `enabledActionTypes`
- `minPriorityScore`
- `inactiveVipMinDays`
- `vipMinLifetimeSpend`
- `packageFollowUpMinInactiveDays`
- `includePaymentFollowUp`
- `ownerInstruction`

Defaults are Myanmar-first and capped at 15 tasks per day.

## Owner Condition Prompt

The owner can type a plain condition, for example:

`Only send top 8 VIP and package tasks. VIP inactive over 60 days and above 1,000,000 MMK. No payment follow-up.`

The backend converts only supported phrases into safe filters. It does not generate SQL, does not calculate financial totals with AI, and does not expose cross-clinic data.

Supported interpretation includes:

- max task count
- VIP/package/rebooking/payment category focus
- exclude payment follow-up
- inactive-day threshold
- minimum VIP lifetime spend
- Myanmar or English output language

## Safety

- Premium access is still enforced with `gt_growth_ai`.
- Basic reports are unchanged.
- Sales Assistant actions remain based on existing report/customer/package/payment facts.
- VIP recovery is shown as a retention opportunity, but average spend is no longer summed as exact estimated opportunity.
- Telegram group targets receive summaries instead of customer-level task lists.

## Files Updated

- `backend/src/types/gt-growth-ai-sales-assistant.ts`
- `backend/src/services/gt-growth-ai/sales-assistant.service.ts`
- `backend/src/routes/gt-growth-ai.routes.ts`
- `backend/src/services/telegram/runtime.service.ts`
- `frontend/src/types/domain.ts`
- `frontend/src/api/gtGrowthAi.ts`
- `frontend/src/features/ai/gt-growth-ai-sales-assistant/GtGrowthAiSalesAssistantPage.tsx`
- `frontend/src/features/settings/telegram/TelegramSettingsPage.tsx`
- `frontend/src/styles/global.css`
- `backend/tests/report-ai-insights.test.ts`

## Recommended Next Step

Phase 4B should add outcome tracking and ROI reporting:

- booked/purchased value attribution
- owner progress dashboard
- task completion rate by salesperson
- weekly recovered revenue summary
- safer customer-level assignment workflow
