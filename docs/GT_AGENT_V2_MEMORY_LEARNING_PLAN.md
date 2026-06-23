# GreatTime AI Agent V2 Memory And Learning Plan

## Scope

This phase adds the first production-safe Agent Hub V2 foundation behind feature flags. The work is additive to the existing Agent Hub routes and Firestore collections, keeps APICORE and BigQuery as the source of truth, and avoids any operational write actions.

## Current Gaps Confirmed

- `backend/src/services/agent-hub/session.repository.ts` stores only V1 session metadata and short-lived entity references.
- `backend/src/services/agent-hub/feedback.repository.ts` stores feedback events but does not convert explicit preferences or corrections into scoped memories.
- `backend/src/services/agent-hub/learning-worker.ts` has no-op `feedback_learning` and `owner_insight_cards` jobs.
- `backend/src/services/agent-hub/learning-worker.ts` records row counts for several jobs but does not consistently persist source-backed V2 snapshots or schedule watermarks.
- `.github/workflows/deploy-backend.yml` creates the Telegram Cloud Scheduler job but does not create the Agent Learning scheduler job.

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
