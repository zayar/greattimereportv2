# GreatTime AI Agent V2 Memory And Learning Plan

## Scope

This phase adds the first production-safe Agent Hub V2 foundation behind feature flags. The work is additive to the existing Agent Hub routes and Firestore collections, keeps APICORE and BigQuery as the source of truth, and avoids any operational write actions.

## Current Gaps Confirmed

- Web requests resolve the clinic code from the trusted clinic record, rather than accepting the browser-supplied value.
- Feedback is bound to a server-persisted response context, preventing a client from attaching feedback to a different recommendation, agent, or tool result.
- Recommendation outcomes are monotonic: lower-confidence events cannot overwrite booked, paid, visited, or other terminal outcomes.
- A bounded recovery pass can run one approved, read-only fallback tool when an owner or appointment summary lacks usable evidence. It cannot invent tools or retry indefinitely.
- The outcome observer and memory-maintenance jobs perform bounded operational work. The weekly business review remains intentionally `not_ready` until its source-backed business-review contract is implemented.

## Remaining Operational Work

- Configure the scheduler in each deployed environment and alert on failed or skipped learning jobs.
- Propagate the execution abort signal into every external data-source client so a timed-out tool can cancel the underlying query as well as stop waiting for it.
- Measure recommendation quality with explicit outcome-attribution rules before using learned signals to change prompts, policies, or business actions.

## Phase Plan

1. Add V2 memory policy, typed records, repository constants, retrieval ranking, and writer helpers under `backend/src/services/agent-hub/memory/`.
2. Extend Agent Hub session summaries and bounded memory retrieval behind `AGENT_MEMORY_V2_ENABLED`.
3. Extend feedback storage while preserving the legacy `rating` field and add recommendation outcome persistence.
4. Implement `feedback_learning` so explicit owner preferences become active memories and repeated evidence can promote inferred preferences.
5. Implement deterministic owner insight cards for unused-package opportunities using existing Customer Relationship profiles.
6. Add production scheduler configuration, `run-all` support, env values, docs, and deployment workflow wiring.

## Safety Rules

- Exact figures must come only from typed source tools or source-backed snapshots with freshness metadata.
- Durable memories may store stable preferences, patterns, and ranking signals, but not transient metrics such as today sales, current balances, or live appointment state.
- Memory writes are best-effort and must not break a valid user answer.
- The existing `customerRelationshipProfiles` collection remains the source for learned customer profiles.
- New Firestore collections use V2 names and can be disabled by setting `AGENT_MEMORY_V2_ENABLED=false` and `AGENT_LEARNING_ENABLED=false`.

## Rollback

Disable these flags to return to the V1 behavior without deleting V2 collections:

- `AGENT_MEMORY_V2_ENABLED=false`
- `AGENT_LEARNING_ENABLED=false`

The existing `/api/ai/agent/chat`, `/api/ai/agent/feedback`, and `/api/ai/agent/session/:sessionId` routes remain backward compatible.
