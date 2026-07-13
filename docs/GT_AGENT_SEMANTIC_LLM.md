# GreatTime Agent Semantic LLM

## Outcome

Agent Hub uses Gemini 3.5 Flash as a bounded semantic planner for English, Myanmar, and mixed-language questions. The model identifies a supported business intent, requested facts, and a grounded customer, service, package, therapist, appointment, or invoice name. GreatTime code—not the model—selects and authorizes the fixed typed tools.

The existing deterministic planner remains the automatic fallback whenever Gemini is disabled, unavailable, slow, low-confidence, invalid, or inconsistent with policy.

## Request Flow

1. Apply the read-only guard before any model call.
2. Resolve safe entity references and date context from the current session.
3. Build the deterministic plan.
4. Ask Gemini for JSON matching the semantic schema.
5. Validate the JSON with Zod.
6. Enforce an explicitly selected agent as a hard constraint.
7. Reject agent/intent combinations outside the supported policy.
8. Re-derive tool names from the backend intent policy.
9. Verify each tool belongs to the selected agent and is read-only.
10. Execute typed source tools and build the deterministic, source-grounded answer.

Gemini never receives permission to generate SQL, GraphQL, business metrics, or arbitrary tool names. It never executes a tool directly.

## Entity Safety

- An extracted entity name is accepted only when it occurs in the current question or matches a recent safe session display name.
- Long numeric strings are redacted from the semantic prompt.
- Clinic IDs, customer keys, raw phone fields, credentials, and authorization headers are not included in semantic session context.
- A semantic entity ID is a short hash, not the customer or service name.
- Exact values still come from APICORE, BigQuery typed report services, or source-backed snapshots.

## Configuration

```dotenv
AI_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.5-flash
AGENT_SEMANTIC_PLANNER_ENABLED=true
AGENT_SEMANTIC_PLANNER_MODEL=gemini-3.5-flash
AGENT_SEMANTIC_PLANNER_TIMEOUT_MS=3000
AGENT_SEMANTIC_PLANNER_MAX_OUTPUT_TOKENS=1200
AGENT_SEMANTIC_PLANNER_MIN_CONFIDENCE=0.65
GEMINI_INPUT_COST_PER_MILLION_USD=1.5
GEMINI_OUTPUT_COST_PER_MILLION_USD=9
```

The pricing variables are monitoring estimates and must be updated when the provider changes pricing. Provider billing remains authoritative.

## Monitoring

Each Agent Hub trace records:

- whether semantic planning was attempted, used, or fell back;
- a bounded fallback reason rather than a raw provider error;
- model/provider and planner latency;
- detected language and confidence;
- prompt/completion token counts;
- estimated request cost.

The AI Control Panel aggregates semantic routing success, fallback count, latency, tokens, and estimated cost for the selected status range.

## Evaluation Set

Before expanding rollout, maintain a versioned set of real, anonymized questions covering:

- English, Myanmar, and mixed-language variants;
- named customer details, last visit, packages, remaining sessions, and therapist history;
- purchased-but-not-started, purchased-but-never-visited, and purchased-but-not-used distinctions;
- top customers by revenue versus visits;
- named service and therapist performance;
- appointment lifecycle and finance sales-versus-collection distinctions;
- follow-ups such as “her details”, ordinals, and a different named entity;
- ambiguous questions, unsupported writes, prompt injection, and hallucinated entity names.

Score at least these fields independently: agent, intent, entity type/name, requested facts, selected tools, period, answer source status, and PII safety. A model/provider change should not ship when read-only safety is below 100%, or when the verified routing set regresses beyond the agreed threshold.

## Rollout

1. Deploy with semantic traces enabled to an internal clinic.
2. Review fallback reasons, wrong-data feedback, cost, and P95 latency daily for at least three business days.
3. Add failed real questions to the anonymized evaluation set before changing prompts.
4. Expand to a small trusted clinic group after routing and entity accuracy are stable.
5. Keep the deterministic fallback and read-only tool policy enabled for every clinic.
