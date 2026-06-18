# Appointment Lifecycle Data Contract

The Agent Hub can safely answer live booking, checked-in, checked-out, cancelled, and no-show questions from current APICORE booking and check-in/out data.

The current inspected schema exposes booking statuses plus check-in `in_time`, `out_time`, and `status`. It does not expose a confirmed treatment-start event. Therefore, a raw `CHECKIN` record is normalized as `arrived_start_unknown`.

## Current Safe Mapping

- `REQUEST` -> `requested`
- `BOOKED` -> `booked`
- `CHECKIN` -> `arrived_start_unknown`
- `CHECKOUT` or `CHECKED_OUT` -> `checked_out`
- `MERCHANT_CANCEL`, `MEMBER_CANCEL`, or `CANCEL` -> `cancelled`
- `NO_SHOW` -> `no_show`

## Not Ready Without More Data

The Agent Hub must not claim that a customer is definitely waiting for treatment or definitely in treatment from `CHECKIN` alone. Questions such as "Who has not started treatment?" should return `not_ready` or clearly label any answer as inferred until APICORE exposes treatment-start evidence.

## Recommended APICORE Extension

Minimal fields on the operational appointment/check-in record:

- `arrived_at`
- `treatment_started_at`
- `treatment_completed_at`
- `checked_out_at`

Preferred event table:

```text
appointment_events
- id
- clinic_id
- booking_id
- check_in_id
- member_id
- service_id
- practitioner_id
- event_type
- occurred_at
- actor_user_id
- metadata_json
```

Recommended event types:

- `ARRIVED`
- `TREATMENT_STARTED`
- `TREATMENT_COMPLETED`
- `CHECKED_OUT`
- `CANCELLED`
- `NO_SHOW`

Once this exists, the Agent Hub can mark waiting and in-progress states as `confirmed` instead of `inferred` or `not_ready`.
