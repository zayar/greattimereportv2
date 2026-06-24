# Customer Relationship Daily Memory V2

## Architecture

Customer Relationship Daily Memory V2 creates a deterministic daily profile from historical BigQuery data, then serves the latest completed run from Firestore.

- APICORE remains authoritative for live appointment, booking, check-in and check-out state.
- BigQuery remains authoritative for historical learning and scheduled profile computation.
- Firestore stores the latest serving profile, learning metadata, feedback fields and follow-up outcomes.
- Normal chat reads Firestore serving profiles. It does not trigger a 365-day BigQuery learning scan.
- Manual Learn/Refresh remains available as an admin recovery action.

The existing `customer_profiles` Agent Learning job runs the daily learning path at `02:00` in the configured scheduler timezone, normally `Asia/Yangon`.

## BigQuery Tables

Provision with [customer_relationship_daily_memory_v2.sql](/Users/zayarmin/Development/GreatTime%20Platform/GT_V2Report/docs/sql/customer_relationship_daily_memory_v2.sql).

`gt_ai_customer_package_daily`

- One row per clinic, customer and package/service purchase for each `snapshotDate`.
- Tracks purchase evidence, matching usage evidence, remaining-session status, activation status, match method and confidence.
- Partitioned by `snapshotDate`.
- Clustered by `clinicId`, `activationStatus`, `customerKey`, `packageId`.
- Partition retention is 540 days.

`gt_ai_customer_relationship_daily`

- One row per clinic and customer for each `snapshotDate`.
- Stores customer-level segments, priority score, reasons, next action, freshness and source metadata.
- Partitioned by `snapshotDate`.
- Clustered by `clinicId`, `primarySegment`, `riskLevel`, `customerKey`.
- Partition retention is 540 days.

## Segment Rules

Grace period constant: `CUSTOMER_RELATIONSHIP_UNACTIVATED_GRACE_DAYS`, default `7`.

Dormancy threshold: `CUSTOMER_RELATIONSHIP_DORMANT_ACTIVE_BALANCE_DAYS`, default `90`.

- `purchase_pending_activation`: matching purchase exists, no matching usage after purchase, purchase age is 0 through 6 days. Low priority and not described as dormant.
- `unactivated_purchase`: matching purchase exists, no matching usage after purchase, purchase age is at least 7 days. Owner label: Bought but not started.
- `dormant_with_active_balance_90d`: confirmed remaining sessions are greater than zero and no matching usage for at least 90 days. If usage never occurred, the purchase date is supporting evidence. Owner label: Dormant package customer.
- `lapsed_customer_90d`: last customer visit is at least 90 days ago and no confirmed active package balance is available.
- `reactivated_customer`: reserved for outcome-observer expansion when a booking, check-in or matching usage occurs after a recorded follow-up.

Primary segment precedence:

1. `unactivated_purchase`
2. `dormant_with_active_balance_90d`
3. `lapsed_customer_90d`
4. `purchase_pending_activation`
5. Existing lower-risk segments

Legacy aliases remain supported:

- `package_bought_never_came`
- `package_bought_not_used`
- `unused_package_balance`

## Matching Strategy

Package activation is calculated per individual package/service purchase.

Matching priority:

1. Stable purchase-line, package, entitlement, service and customer IDs when available.
2. Stable customer ID plus normalized package/service identity.
3. Customer phone identity plus normalized package/service identity.
4. Customer name matching only as the last fallback.

Low-confidence name matching stores `matchMethod` and `matchConfidence`, marks the row `partial`, and uses cautious wording such as “usage could not be confirmed.”

An unrelated customer visit never activates a different purchased package. Remaining package balance is not inferred from invoice price. If no authoritative package balance exists, `balanceStatus` is `unknown` and `remainingSessions` is nullable.

## Firestore Serving Safety

Each V2 profile includes:

- `learningRunId`
- `snapshotDate`
- `learnedAt`
- `sourceWatermark`
- `ruleVersion`
- `dataStatus`

When V2 is enabled, profile searches only return profiles whose `learningRunId` matches the latest completed learning run for that clinic. Failed runs are recorded but ignored by serving reads, so the previous completed run stays active.

Mutable fields preserved across refresh:

- `lastFollowUpAt`
- `lastFollowUpOutcome`
- `followUpCount`
- `lastMatchedAt`
- `lastMatchedIntent`

## Freshness Behavior

- 0 to 24 hours old: answer normally.
- 24 to 48 hours old: answer with a stale-data notice.
- Older than 48 hours: warn that learned memory is historical context only.
- Unavailable or no completed V2 run: return `not_ready` instead of inventing customers.

For live operational questions containing words such as today, now, currently, checked in, new booking or live appointment, use learned profiles only for historical context. APICORE typed tools must verify and override live operational state.

## Follow-Up Ranking

“Who should we follow up today?” uses deterministic Firestore profile ranking:

- Excludes recent `booked` outcomes for `CUSTOMER_RELATIONSHIP_FOLLOW_UP_COOLDOWN_DAYS`.
- Lowers priority after `replied`.
- Excludes `wrong_number`.
- Excludes `not_interested` for `CUSTOMER_RELATIONSHIP_NOT_INTERESTED_COOLDOWN_DAYS`.
- Avoids repeatedly recommending recently matched customers.
- Sorts by deterministic priority score. The LLM does not modify scores.

## Privacy

- Generic rows use masked phone numbers only.
- LLM prompts receive bounded rows, not full customer tables.
- Customer detail drill-down must use authorized customer views.
- No secrets, credentials or raw backend errors are exposed.

## Rollback

Feature flag:

```env
CUSTOMER_RELATIONSHIP_DAILY_MEMORY_V2_ENABLED=false
```

Default is `false`. When disabled, the legacy Customer Relationship learning and serving behavior remains active.

## Deployment Steps

1. Apply `docs/sql/customer_relationship_daily_memory_v2.sql` after replacing `PROJECT_ID.DATASET`.
2. Grant the backend service account BigQuery permissions listed below.
3. Deploy the backend and frontend with the flag still disabled.
4. Run existing tests and one manual Learn/Refresh in a non-production clinic if available.
5. Enable `CUSTOMER_RELATIONSHIP_DAILY_MEMORY_V2_ENABLED=true`.
6. Let the existing Agent Learning scheduler run `customer_profiles` at `02:00 Asia/Yangon`, or use the admin Learn/Refresh action once.
7. Verify Firestore learning run metadata shows `status=completed` and a `learningRunId`.

## BigQuery IAM

The runtime service account needs:

- `roles/bigquery.jobUser` on the billing project.
- `roles/bigquery.dataViewer` on the source analytics dataset/views.
- `roles/bigquery.dataEditor` on the target AI dataset containing the two daily memory tables.

Do not edit credentials or real environment files as part of this deployment.

## Test Commands

```bash
npm ci
npm run build
npm run test
```
