# GreatTime Agent Hub Performance Plan

## Goals

GreatTime V2 Agent Hub should answer common owner questions from prepared snapshots first, expose operational health clearly, and keep every Agent Hub capability read-only. This phase improves speed and observability without replacing the rule-based planner, adding a vector database, or rewriting Agent Hub.

## Scheduler Model

The learning scheduler calls `POST /api/internal/agent-learning/tick` with `x-agent-learning-scheduler-secret`. The worker reads enabled clinic schedules from `gtAgentLearningSchedulesV1`, acquires per-clinic job locks, runs due jobs, writes learning runs to `gtAgentLearningRunsV1`, and stores fact snapshots in `gtAgentFactSnapshotsV2`.

The most important snapshot jobs are:

- `finance_daily_snapshot`: completed-day sales and payment facts.
- `appointment_daily_profile`: completed-day appointment lifecycle profile.
- `appointment_operational_snapshot`: current-day appointment state.
- `service_profiles`: service performance profile.
- `practitioner_profiles`: practitioner performance profile.
- `owner_insight_cards`: ranked owner risks and opportunities in `gtAgentInsightCardsV2`.
- `feedback_learning` and `recommendation_outcome_observer`: learn from feedback and outcomes.

## Recommended Cadence

- Operational appointment snapshot: every 15 minutes during clinic hours, 30-60 minutes off-hours if enabled.
- Daily finance and appointment snapshots: once after close, plus one retry the next morning.
- Service and practitioner profiles: daily after the finance snapshot is available.
- Owner insight cards: daily after all daily/profile snapshots complete.
- Feedback learning: every 1-4 hours.
- Recommendation outcome observer: daily.
- Memory maintenance: daily or weekly depending on volume.

## Required Env Variables

- `AGENT_HUB_READ_ONLY_MODE=true`
- `AGENT_LEARNING_ENABLED=true`
- `AGENT_LEARNING_SCHEDULER_SECRET=...`
- `AGENT_SNAPSHOT_CACHE_ENABLED=true`
- `AGENT_COMPLETED_DAY_SNAPSHOT_ENABLED=true`
- `AGENT_OWNER_DAILY_BRIEF_ENABLED=true`
- `AGENT_NARRATIVE_ENABLED=true`
- `AGENT_NARRATIVE_CACHE_ENABLED=true`
- `AGENT_NARRATIVE_SKIP_FAST_INTENTS=true`
- `AGENT_NARRATIVE_TIMEOUT_MS=1500`
- `AGENT_BIGQUERY_TIMEOUT_MS=8000`
- `AGENT_TOOL_MAX_CONCURRENCY=3`
- `AGENT_OPERATIONAL_SNAPSHOT_MAX_AGE_MINUTES=20`
- `AGENT_SNAPSHOT_MAX_AGE_MINUTES=1440`
- `BQ_QUERY_CACHE_ENABLED=true`
- `BQ_QUERY_DEFAULT_TTL_MS=60000`

## AI Health Dashboard

The AI Control Panel reads `GET /api/ai/agent/status`. Clinic-scoped views require clinic access. Cross-clinic views are admin-only.

Health levels:

- `healthy`: no critical or warning alerts in the selected range.
- `degraded`: stale snapshots, stale learning jobs, narrative fallbacks, timeouts, or elevated latency are present.
- `critical`: wrong-data feedback, high timeout rate, high tool failure rate, or critical latency is present.
- `unknown`: no traces, learning runs, feedback, outcomes, or snapshots were found.

Cards to watch:

- Overall AI health: top-level status.
- Last 24h questions: Agent Hub usage.
- Average latency and P95 latency: end-user speed.
- Timeout count and tool failure rate: source/tool reliability.
- Latest learning run: scheduler freshness.
- Stale snapshots: snapshot readiness.
- Wrong-data feedback: correctness risk requiring urgent review.

## Snapshot-First Behavior

`get_owner_daily_brief` uses snapshots and active insight cards first:

- `finance_daily_snapshot`
- `appointment_daily_profile`
- `appointment_operational_snapshot`
- `service_profiles`
- `practitioner_profiles`
- `gtAgentInsightCardsV2`

If a snapshot is missing, the tool returns a partial deterministic answer with warnings and source freshness. It does not run heavy live BigQuery fallback by default. Direct service, practitioner, finance, and appointment drill-down tools keep their existing live/source-backed behavior.

Fast deterministic intents can skip Gemini:

- `owner_daily_brief`
- `appointment_summary`
- `payment_summary`
- simple table responses

When narrative is used, responses are cached for 5 minutes by clinic, intent, period, source `checkedAt` values, and summary hash. Narrative timeout falls back to deterministic output.

## Rollout Plan

1. Enable scheduler and status dashboard for internal clinics only.
2. Verify daily snapshots and operational snapshots appear in AI health for 3-5 business days.
3. Review wrong-data feedback and stale snapshot alerts daily.
4. Enable GT Growth AI for a small group of trusted clinics.
5. Keep cross-clinic status admin-only while customer-facing usage grows.
6. Expand to subscription customers after owner brief latency and snapshot freshness are stable.

## Suggested Production Settings

- Keep `AGENT_HUB_READ_ONLY_MODE=true`.
- Keep owner daily brief timeout around 3 seconds; it should normally finish under 1.5 seconds from snapshots.
- Keep normal Agent Hub questions under 4 seconds when snapshots/cache exist.
- Allow heavy 360 tools 8-15 seconds.
- Alert when P95 latency exceeds 4 seconds and treat 8 seconds as critical.
- Treat any wrong-data feedback as critical until reviewed.
- Keep BigQuery query cache enabled with a 60-second TTL.
- Do not add Agent Hub write-back actions in this phase.
