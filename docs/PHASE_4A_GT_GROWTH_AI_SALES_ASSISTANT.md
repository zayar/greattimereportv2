# Phase 4A GT Growth AI Sales Assistant

## Business Goal

Phase 4A adds the first money-focused paid GT Growth AI workflow:

AI finds opportunity -> AI sends task list to sales lead -> sales lead contacts customers -> sales lead marks progress -> owner sees progress.

This supports the 100,000 MMK/month positioning by turning reports into daily revenue recovery work, not only summaries.

## Current Assumptions

- Basic appointment, payment, weekly, and Telegram reports remain free.
- `gt_growth_ai` remains the premium gate.
- Paid entitlement is checked on the backend through `feature-access.service.ts`.
- Merchant settings may configure delivery preferences only after entitlement is active.
- Normal merchants cannot self-enable paid access from the Telegram settings UI.
- The existing feature route is retained as a temporary internal/admin hook until billing/admin tooling exists.

## Free vs Paid Behavior

Free clinics:
- Continue receiving normal Telegram reports.
- See a locked Sales Assistant preview.
- Cannot generate or view full sales actions.
- Cannot receive customer-level Sales Assistant task lists.
- Telegram `/tasks` replies with an upgrade message.

Paid clinics:
- Can generate deterministic daily sales actions.
- Can view the action queue in the frontend.
- Can configure linked Telegram targets as sales lead, owner group, manager, finance, reception, or general reports.
- Can send daily task lists to the sales lead target.
- Can receive owner progress summaries.
- Can update task status from Telegram commands or the web queue.

## Backend Routes

Added under `/api/gt-growth-ai`:

- `GET /sales-assistant/actions`
- `POST /sales-assistant/generate`
- `POST /sales-assistant/send`
- `POST /sales-assistant/actions/:actionId/status`
- `GET /sales-assistant/progress`

All routes require Firebase auth and clinic access. Full action data requires `gt_growth_ai`; locked previews are safe and do not expose customer details.

## Firestore Collections

New collections:

- `gt_growth_ai_sales_actions`
  - Stores deterministic action rows, evidence, masked customer identity, estimated value when available, assignment, and status.
- `gt_growth_ai_telegram_task_sessions`
  - Stores short-lived task index mappings for Telegram commands such as `C1`, `B1`, `P1`, `S1`, and `M1`.

Existing collections reused:

- `gt_v2report_telegram_targets`
- `gt_v2report_telegram_chat_links`
- `gt_v2report_telegram_schedule_locks`

## Telegram Target Purpose Model

Telegram targets now have:

- `targetPurpose`
- `isGtGrowthAiSalesAssistantEnabled`
- `gtGrowthAiSalesAssistantTime`
- `isGtGrowthAiOwnerProgressSummaryEnabled`
- `gtGrowthAiOwnerProgressSummaryTime`

Supported purposes:

- `general_reports`
- `owner_group`
- `sales_lead`
- `reception`
- `finance`
- `manager`
- `other`

Sales task lists prefer `sales_lead`. Owner progress summaries go to `owner_group` or `manager`.

## Action Generation Rules

Implemented deterministic rules:

- Rebooking opportunity
- Package usage follow-up
- Package upsell opportunity
- Inactive VIP follow-up
- Payment follow-up

All evidence and values come from existing reports, BigQuery-backed report services, appointment report data, customer portal data, package portal data, or payment report rows. No LLM calculates money or invents facts.

## Priority Scoring

Priority score uses:

- Estimated value
- Urgency
- Customer importance
- Evidence confidence

Priority mapping:

- `75+` = high
- `45-74` = medium
- `<45` = low

The score is deterministic and stored on each action.

## Telegram Commands

Supported commands:

- `/tasks`
- `/today`
- `C1` or `/contacted 1`
- `B1` or `/booked 1`
- `P1` or `/purchased 1`
- `S1` or `/skipped 1`
- `M1` or `/message 1`

The bot maps indexes to action IDs through the latest task session for that chat and date.

## Telegram Message Examples

Sales lead:

```text
GT Growth AI — Today's Sales Tasks

Today I found 10 revenue opportunities.
Estimated opportunity: 1,850,000 MMK.

1. Customer A
Reason: Completed treatment customers are easiest to rebook within 24-48 hours.
Action: Contact this customer within 24-48 hours and help them book the next visit.
Value: 450,000 MMK

Reply:
C1 = contacted, B1 = booked, P1 = purchased, S1 = skipped
M1 = show suggested message
/tasks = show today's tasks
```

Owner summary:

```text
GT Growth AI assigned 10 sales follow-up tasks to Sales Lead.

Today's focus:
- Rebooking: 4
- Package follow-up: 3
- Package upsell: 2
- VIP follow-up: 1
- Payment follow-up: 1

I will send progress summary later.
```

## Frontend Settings Behavior

Telegram settings now show:

- Read-only GT Growth AI access status.
- Locked upsell copy for unpaid clinics.
- Sales Assistant delivery controls for paid clinics.
- Target purpose selector.
- Daily Sales Assistant send time.
- Owner progress summary toggle and time.
- Manual Sales Assistant test send.

The old merchant-facing entitlement toggle was removed from the settings UI.

## Frontend Action Queue

Added `/ai/gt-growth-ai-sales-assistant`.

The page shows:

- Locked preview for unpaid clinics.
- Generate actions button for paid clinics.
- Send to sales lead button.
- Summary KPI strip.
- Action table with priority, customer, evidence, estimated value, suggested message, and status update controls.

## Privacy and Security

- Backend enforces `gt_growth_ai`; frontend gating is display-only.
- All routes require clinic access.
- Locked previews expose no customer details.
- Phone numbers are masked.
- Telegram command handling uses stored chatId-to-clinic mapping, not chat titles.
- Group task messages hide customer names.
- Payment follow-up task messages do not include invoice evidence in group task output.
- No arbitrary natural-language SQL, predictive AI, vector DB, or customer campaign sending was added.

## Testing Completed

Automated tests added for:

- Deterministic generation of all five action types.
- Deduplication.
- Empty data safety.
- Locked preview safety.
- Priority scoring.
- Telegram task message privacy for group targets.

Build and test command results should be recorded in the implementation final response.

## Known Limitations

- Paid entitlement is still backed by environment override and temporary Firestore feature access until production billing/admin tooling exists.
- Scheduled Sales Assistant sends use the existing scheduler lock collection, but delivery history cards do not yet list Sales Assistant sends.
- Customer future-booking evidence depends on available source data; if unavailable, actions use only known deterministic facts.
- Telegram task list is limited to the top 10 actions.
- Suggested messages are deterministic Myanmar text templates, not personalized LLM output.

## Recommended Next Phase

Phase 4B — ROI Tracking:

- Track contacted/booked/purchased outcomes against estimated opportunity.
- Add owner ROI cards such as recovered revenue, booked value, package conversion, and pending follow-up value.
- Add Sales Assistant delivery history.
- Add admin/billing entitlement management if available.
