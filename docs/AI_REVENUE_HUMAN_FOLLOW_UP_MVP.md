# AI Revenue Human Follow-Up MVP

## Goal

The MVP workflow is:

1. AI finds the right customer and service opportunity.
2. A human staff member follows up by phone, manual Viber, in person, or another manual channel.
3. Staff records the contact result, note, and next follow-up date.
4. Firestore tracks the workflow state, contact attempts, timeline mirror, suppressions, and outcome links.
5. APICORE, MySQL, and BigQuery remain read-only source-of-truth systems for customers, bookings, treatments, packages, and revenue.

This MVP does not send real Viber/provider messages automatically and does not retrain a model. "System learns" means GT V2 stores structured workflow and outcome records so future dashboards can measure which follow-ups became bookings, treatments, package usage, repurchases, and attributed revenue.

## Data Flow

1. Opportunity generation reads source data from APICORE/BigQuery and writes AI Revenue workflow actions to `gt_ai_revenue_actions`.
2. The Follow Up tab loads actions from Firestore and filters queues by `dueDateKey`, `visibilityState`, and workflow fields.
3. Staff clicks `Log Call` or `Log Viber` and records channel, result, note, and optional next date/booking/outcome data.
4. Backend validates the request with Zod and calls `recordAiRevenueFollowUpAttempt`.
5. The service writes:
   - one contact attempt in `gt_ai_revenue_contact_attempts`
   - one customer timeline mirror in `gt_ai_revenue_customer_timeline_events`
   - a workflow patch on the parent `gt_ai_revenue_actions` document
   - optional suppression in `gt_ai_revenue_customer_suppressions`
   - optional outcome link in `gt_ai_revenue_outcome_links`
   - audit log entries in `gt_ai_revenue_audit_logs`
6. Existing draft approval/message endpoints remain compatibility workflow only. They do not send real Viber messages.

## Firestore Collections

### `gt_ai_revenue_actions`

Parent workflow document for an AI Revenue opportunity. Stores staff task state only:

- `workflowState`
- `visibilityState`
- `originalDateKey`
- `dueDateKey`
- `nextFollowUpAt`
- `opportunityKey`
- assignment fields
- attempt counters
- latest contact fields
- completion/closure fields
- display reason and AI suggestion
- service usage snapshot
- attribution links in nested legacy fields where present

It must not mutate APICORE/MySQL/BigQuery source records.

### `gt_ai_revenue_contact_attempts`

Append-only staff contact attempt records. Stores:

- action/customer identity
- staff agent identity
- channel
- result
- note
- optional manual message text
- next follow-up date
- creator and timestamp

### `gt_ai_revenue_customer_timeline_events`

GT V2 mirror timeline for staff/customer contact history. This does not write to APICORE. It mirrors follow-up attempts so the customer history can later show service follow-up activity.

### `gt_ai_revenue_customer_suppressions`

Suppression records for future AI Revenue generation and active queues. Supported scopes include:

- `customer`
- `service`
- `phone_only`
- `channel`
- `opportunity_type`

### `gt_ai_revenue_outcome_links`

Structured outcome records linking follow-up actions to later business outcomes:

- appointment booked
- customer came
- treatment completed
- package session used
- repurchase
- revenue attributed

### `gt_ai_revenue_message_events`

Manual/mock/provider message event history. For this MVP, manual message-sent follow-ups may create outbound message events when staff provides message text, but the system does not send provider messages automatically.

### `gt_ai_revenue_audit_logs`

Manager/admin audit history for status changes, workflow updates, suppressions, outcome links, and legacy approval actions.

## State Transition Table

| Follow-up result | With next date | Workflow state | Visibility state | Status behavior |
| --- | --- | --- | --- | --- |
| `no_answer` | no | `contacted` | `active` | `human_takeover` |
| `no_answer` | yes | `scheduled_follow_up` | `scheduled` | `human_takeover` |
| `message_sent` | no | `contacted` | `active` | `sent` |
| `message_sent` | yes | `scheduled_follow_up` | `scheduled` | `sent` |
| `customer_replied` | no | `waiting_customer` | `active` | `customer_replied` |
| `customer_replied` | yes | `scheduled_follow_up` | `scheduled` | `customer_replied` |
| `interested` | no | `waiting_customer` | `active` | `customer_replied` |
| `interested` | yes | `scheduled_follow_up` | `scheduled` | `customer_replied` |
| `call_later` | required | `scheduled_follow_up` | `scheduled` | `human_takeover` |
| `appointment_booked` | ignored | `appointment_booked` | `completed` | `appointment_created` when booking ID exists, otherwise `appointment_requested` |
| `already_booked` | ignored | `appointment_booked` | `completed` | `appointment_created` when booking ID exists, otherwise `appointment_requested` |
| `already_visited` | ignored | `completed` | `completed` | `customer_came` or `completed` |
| `not_interested` | ignored | `closed` | `completed` or `suppressed` | `not_interested` |
| `wrong_number` | ignored | `closed` | `suppressed` | `closed` |
| `do_not_contact` | ignored | `closed` | `suppressed` | `closed` |
| `completed` | ignored | `completed` | `completed` | `completed` |
| `other` | no | `contacted` | `active` | `human_takeover` |
| `other` | yes | `scheduled_follow_up` | `scheduled` | `human_takeover` |

`call_later` requires `nextFollowUpAt` or `nextFollowUpDateKey`; otherwise the service rejects the request with a 400 validation error.

## Follow-Up Results

Staff can record these contact results:

- `no_answer`
- `call_later`
- `message_sent`
- `customer_replied`
- `interested`
- `appointment_booked`
- `already_booked`
- `already_visited`
- `not_interested`
- `wrong_number`
- `do_not_contact`
- `completed`
- `other`

The Follow Up queue uses `visibilityState` and `dueDateKey`:

- Today: active actions due today or earlier
- Overdue: active actions due before today
- Tomorrow: active or scheduled actions due tomorrow
- Next 7 Days: open actions due between tomorrow and 7 days out
- All Open: active or scheduled actions
- Completed: completed actions
- Suppressed: suppressed actions

Completed, suppressed, and hidden actions do not appear in the Today queue.

## Suppression Behavior

When staff records `wrong_number` or `do_not_contact`, the service:

1. Sets `workflowState = closed`.
2. Sets `visibilityState = suppressed`.
3. Sets `status = closed`.
4. Sets `closedAt` and `closedReason`.
5. Creates a customer suppression record.

Default scopes:

- `wrong_number` defaults to `phone_only`.
- `do_not_contact` defaults to `customer`.

Suppressions are additive and keep old suppression documents valid. Generation must respect existing suppressions so a customer/service does not reappear after staff closed or suppressed it.

## Outcome Tracking Behavior

Outcome tracking is stored in `gt_ai_revenue_outcome_links`.

The service creates outcome links when:

- staff records an appointment-booked follow-up and booking/appointment data is present
- staff provides an explicit outcome payload
- appointment lifecycle updates mark booking, came, or treatment completed
- revenue attribution records package sessions, repurchase, or revenue attribution

Outcome links can include:

- `bookingId`
- `treatmentId`
- `orderId`
- `invoiceNumber`
- `serviceId`
- `serviceName`
- `revenueAmount`
- `packageSessionsRecovered`
- `attributionType`
- `eventAt`

The Action Detail panel shows per-action outcome history and counts by outcome type. The MVP does not build a full attribution dashboard yet.

## Firestore Index Notes

MVP filtering fetches by `clinicId` and applies queue filters in memory, with Firestore limits capped for safety. This is acceptable for the initial rollout.

Recommended future composite indexes:

### `gt_ai_revenue_actions`

- `clinicId` + `visibilityState` + `dueDateKey` + `priorityScore desc`
- `clinicId` + `assignedToUserId` + `visibilityState` + `dueDateKey`
- `clinicId` + `workflowState` + `dueDateKey`
- `clinicId` + `opportunityKey` + `visibilityState`

### `gt_ai_revenue_contact_attempts`

- `clinicId` + `actionId` + `createdAt desc`
- `clinicId` + `agentUserId` + `createdAt desc`

### `gt_ai_revenue_outcome_links`

- `clinicId` + `actionId` + `eventAt desc`
- `clinicId` + `outcomeType` + `eventAt desc`

## Known Limitations

- The Follow Up tab filters loaded actions client-side for MVP queue views.
- Firestore queries intentionally avoid many composite indexes until queue volume proves the need.
- The timeline event is a GT V2 mirror only and does not mutate APICORE customer history.
- Booking, treatment, package, and revenue source records remain read-only and must be synced or linked through existing read-only source workflows.
- Outcome attribution is structured but simple. It is not model retraining and not a final revenue attribution dashboard.
- Manual message text is recorded only when staff chooses a manual messaging workflow. No real provider send is triggered.
- Existing draft, approve, mark sent, reject, and message event endpoints remain for compatibility, but staff follow-up is the primary workflow.

## Future Viber Automation Plan

This MVP prepares the workflow for future Viber automation without sending provider messages automatically.

Future automation should:

1. Reuse the same `gt_ai_revenue_actions` workflow states.
2. Write every provider send attempt to `gt_ai_revenue_contact_attempts`.
3. Write outbound/inbound provider events to `gt_ai_revenue_message_events`.
4. Continue writing customer timeline mirrors to `gt_ai_revenue_customer_timeline_events`.
5. Link booking, treatment, package, repurchase, and revenue outcomes through `gt_ai_revenue_outcome_links`.
6. Respect suppression scopes before sending anything.
7. Keep human approval or manual mode as the default until provider safety, consent, retry, and audit policies are explicitly implemented.

Automation must not bypass the human workflow model. Provider sends should be another contact channel in the same contact attempt and outcome tracking system, not a separate workflow.
