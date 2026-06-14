# Phase 3 GT Growth AI Feature Access

## Objective

Phase 3 adds a lightweight clinic-level control for `gt_growth_ai` so GT Growth AI can be enabled without changing Cloud Run environment variables for every merchant.

This is not a billing system. It is a production-friendly feature-access bridge until real subscription/entitlement data exists.

## Backend Behavior

Feature gate:

- `gt_growth_ai`

Access sources, in priority order:

1. Cloud Run environment override
2. Firestore clinic feature setting
3. Default locked state

Environment variables:

- `GT_GROWTH_AI_DEFAULT_ENABLED`
- `GT_GROWTH_AI_ENABLED_CLINIC_IDS`
- `GT_GROWTH_AI_FEATURE_STORE_ENABLED`

Firestore collection:

- `gt_v2report_feature_access`

Document ID:

- clinic ID

Stored feature path:

- `features.gt_growth_ai.enabled`
- `features.gt_growth_ai.updatedAt`
- `features.gt_growth_ai.updatedByUserId`
- `features.gt_growth_ai.updatedByEmail`

## API

Protected routes:

- `GET /api/features/gt-growth-ai?clinicId=...`
- `POST /api/features/gt-growth-ai`

POST body:

```json
{
  "clinicId": "clinic_id",
  "enabled": true
}
```

Both routes use Firebase auth and existing clinic-access checks.

## Frontend

The Telegram settings page now includes a clinic-level `GT Growth AI` card.

It shows:

- Enabled / locked status
- Access source
- Last updated metadata
- Toggle to enable/disable clinic setting

If Cloud Run env enables the clinic, the UI shows the feature as enabled by environment and disables editing, because the env override wins.

## Free vs Premium

Free behavior is unchanged:

- Basic reports remain available.
- No premium GT Growth AI sections are returned when access is disabled.

Premium behavior:

- Daily Appointment Report GT Growth AI section
- Daily Payment Report GT Growth AI section
- Weekly Summary Report GT Growth AI section
- Frontend payment report AI cards where supported
- Myanmar Telegram GT Growth AI block

## Testing

Automated checks:

- Backend tests
- Backend TypeScript build
- Frontend build

Manual QA:

1. Deploy latest backend/frontend.
2. Open Settings > Telegram.
3. Find the `GT Growth AI` card.
4. Enable the feature for a clinic.
5. Send a Daily Payment Report test.
6. Confirm Telegram shows the Myanmar `GT Growth AI` block.
7. Disable the feature.
8. Send another Daily Payment Report test.
9. Confirm Telegram shows only the normal basic report.

## Limitations

- This is still not billing. Real subscription/entitlement should replace the Firestore setting later.
- Any authenticated user with clinic access can update this setting, matching the current settings access pattern.
- Cloud Run env overrides are intentionally still supported for rollout and emergency access.

## Recommended Next Step

Connect this setting to the future billing/subscription source, then add audit/reporting around which clinics have GT Growth AI enabled.
