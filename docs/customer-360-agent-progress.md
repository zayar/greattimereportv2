# Customer 360 Agent Progress

## Completed

- Added one-shot Customer 360 routing for named prompts such as `Tell me about Soe Moe Thu`, `Show Soe Moe Thu`, and `What do we know about Soe Moe Thu`.
- Added a shared customer query extractor so generic operational prompts such as `Show all appointments today` stay routed to the right non-customer agent.
- Added a bounded BigQuery customer identity resolver with masked disambiguation rows and member/phone-aware detail scoping.
- Added the additive `Customer360FactPack` response contract with scoped sources, data-quality notes, and dynamic follow-up questions.
- Added the composite `get_customer_360` Agent Hub tool. It resolves identity first, then builds a typed fact pack from:
  - BigQuery customer overview and historical completed treatments.
  - APICORE package holdings.
  - BigQuery payment and usage reports.
  - APICORE live/current/upcoming booking ledger.
  - Firestore learned profiles for recommendation support only.
- Added deterministic Customer 360 answer composition before optional AI wording.
- Limited the optional narrative prompt to the bounded fact pack and fixed Agent Hub trace `fallbackUsed` to reflect whether optional AI wording actually failed or was unavailable.
- Added an Agent Hub Customer 360 card with source/freshness chips, scope labels, data-quality notes, package/payment/usage/appointment sections, and a customer detail deep link.

## Changed Files

- `backend/src/services/agent-hub/customer-query.ts`
- `backend/src/services/agent-hub/customer-360.service.ts`
- `backend/src/services/agent-hub/types.ts`
- `backend/src/services/agent-hub/supervisor.ts`
- `backend/src/services/agent-hub/intent-planner.ts`
- `backend/src/services/agent-hub/agent-hub.service.ts`
- `backend/src/services/agent-hub/narrative.service.ts`
- `backend/src/services/agent-hub/response-builder.ts`
- `backend/src/services/agent-hub/tools/customer.tools.ts`
- `backend/src/services/reports/customer-portal.service.ts`
- `backend/src/services/reports/package-portal.service.ts`
- `backend/tests/agent-hub.test.ts`
- `frontend/src/types/domain.ts`
- `frontend/src/features/ai/agent-hub/AgentHubPage.tsx`
- `frontend/src/styles/global.css`

## Validation

- `npm ci` passed.
  - npm reported 32 audit findings already present in the dependency tree. No broad dependency remediation was run for this feature.
- `npm run test` passed.
  - Backend: 68 tests passed.
  - Frontend: 32 tests passed.
- `npm run build` passed.
  - Vite reported the existing large JavaScript chunk warning.

## Known Limitations

- Live appointment matching uses APICORE booking phone when available, then exact normalized name as a fallback. If APICORE exposes a stable member/customer ID on booking rows later, Customer 360 should use it.
- APICORE package holdings provide stable holding IDs and current balances. If that source is unavailable, the agent does not present an exact combined package balance.
- Firestore learned profiles are used only for segments/recommendation support. They do not override BigQuery/APICORE facts.
- The next improvement-loop prompt remains separate: richer feedback capture, verified recommendation outcomes, bounded ranking updates, and memory maintenance are not part of this MVP.
