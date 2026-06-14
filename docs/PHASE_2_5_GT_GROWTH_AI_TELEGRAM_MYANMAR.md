# Phase 2.5 GT Growth AI Telegram Myanmar Output

## Objective

Phase 2.5 makes GT Growth AI visibly different inside Telegram reports, where most merchants currently read daily and weekly business updates.

Scope is limited to Telegram output for:

- Daily Appointment Report
- Daily Payment Report
- Weekly Summary Report

No predictive AI, campaign automation, vector database, billing integration, or Customer Relationship Agent changes are included.

## Behavior

When `gt_growth_ai` is disabled:

- Telegram reports keep the normal basic report output.
- No premium GT Growth AI section is shown.

When `gt_growth_ai` is enabled:

- Telegram reports append a concise `GT Growth AI` section.
- The section defaults to Myanmar wording.
- It includes:
  - AI summary
  - "Why it matters" evidence
  - Business opportunity
  - Recommended actions

## Example

```text
🤖 GT Growth AI
အကျဉ်းချုပ်: Payment မရှင်းလင်းသေးသောအချက်ရှိနေသဖြင့် ပိတ်ချိန်မတိုင်မီ follow-up လုပ်ရန် အရေးကြီးပါသည်။
ဘာကြောင့်အရေးကြီးလဲ:
- မရှင်းလင်းသေးသောငွေ: 2,460,000 MMK
- သက်ဆိုင်သော invoice: 2
လုပ်ငန်းအခွင့်အလမ်း:
- မရှင်းလင်းသေးသော payment ကို ပိတ်ချိန်မတိုင်မီ follow-up လုပ်ပါ (2,460,000 MMK)
လုပ်ဆောင်ရန်:
1. မရှင်းလင်းသေးသော payment များကို ပိတ်ချိန်မတိုင်မီ follow-up လုပ်ပါ
```

## Implementation

Shared formatter:

- `backend/src/services/telegram/gt-growth-ai-message.ts`

Report services updated:

- `backend/src/services/telegram/report.service.ts`
- `backend/src/services/telegram/payment-report.service.ts`
- `backend/src/services/telegram/weekly-summary-report.service.ts`

The formatter uses only:

- Existing `gtGrowthAi` payload
- Deterministic insight evidence
- Deterministic business opportunity evidence
- Deterministic next actions

It does not invent financial values.

## Language Choice

Myanmar is now the default Telegram wording for the premium section because most current clients are Myanmar merchants.

Dynamic service names, therapist names, payment methods, package names, and numeric values remain as they come from the report data.

## Testing

Automated tests cover:

- Myanmar GT Growth AI block appears when premium payload exists.
- Old `AI Actions:` text is no longer used for the payment report.
- Formatter returns no section when no premium payload exists.

Manual testing:

- Send Daily Payment Report for a premium clinic and confirm the `GT Growth AI` block appears.
- Send the same report for a non-premium clinic and confirm no premium block appears.
- Repeat with Daily Appointment Report and Weekly Summary Report.
