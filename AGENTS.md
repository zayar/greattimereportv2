# AGENTS.md

## Purpose

GreatTime Report V2 is the React/Express/TypeScript reporting, operations, GT Growth AI, Telegram, and analytics application for GreatTime. `gt.apicore` remains the operational source of truth. BigQuery is used for historical analytics and learned profiles.

## Important Directories

- `backend/src/routes/` - Express API routes.
- `backend/src/services/` - typed APICORE, BigQuery, AI, report, Telegram, and business services.
- `backend/src/services/reports/` - source-grounded analytics and customer/service/practitioner reports.
- `backend/src/middleware/` - Firebase authentication and clinic access.
- `frontend/src/features/` - product pages and workflows.
- `frontend/src/api/` - typed browser API clients.
- `frontend/src/types/` - shared frontend domain types.
- `docs/` - architecture, deployment, and implementation notes.

## Commands

- Install: `npm ci`
- Build/typecheck: `npm run build`
- Tests: `npm run test`
- Development: `npm run dev`

Before finishing code changes, run `npm ci`, `npm run build`, and `npm run test`. Report any command that cannot run and the exact reason.

## Source Of Truth Rules

- Exact business metrics must come from typed BigQuery report services, APICORE, or a source-backed snapshot with freshness metadata.
- APICORE/MySQL is authoritative for live appointment, booking, check-in, and check-out state.
- BigQuery is authoritative for historical analytics, trends, comparisons, and scheduled profile computation.
- Firestore stores agent sessions, stable preferences, feedback, run traces, learning logs, and expiring insight cards. It must not override current source data.
- The LLM must not invent, recalculate, or change business figures.
- Do not let an LLM generate or execute free-form SQL or GraphQL.

## Agent Safety Rules

- Agent capabilities are read-only unless a future task explicitly adds an approved APICORE action flow.
- Do not directly mutate MySQL, bookings, check-ins, payments, invoices, customers, packages, services, practitioners, or inventory.
- Future actions require explicit user confirmation, APICORE execution, and audit logging.
- Memory may add stable context but cannot override current tool data.
- Firestore memory/trace writes are best-effort and must not fail user-facing read flows.
- Return safe `partial`, `stale`, `not_ready`, or `unavailable` statuses instead of guessing.
- Do not expose raw backend errors, stack traces, secrets, authorization headers, or service credentials.

## Agent Hub Read-Only Enforcement

- User-facing Agent Hub tools are read-only for business source data.
- Business source mutations are forbidden through Agent Hub, including APICORE/MySQL writes, BigQuery DDL/DML, arbitrary SQL or GraphQL mutations, booking/canceling appointments, charging/refunding payments, editing customers, or sending messages.
- Agent metadata writes are allowed for sessions, traces, feedback, memory, learning logs, insight cards, and source-backed snapshots.
- Future approved action workflows must create draft, approval, and audit records before any external business action is possible.
- Any future mutation-capable tool must not be available when `AGENT_HUB_READ_ONLY_MODE=true`.
- User-facing Agent Hub BigQuery execution must run under the read-only analytics query guard.

## Clinic Isolation And Privacy

- Every user-facing data route requires Firebase authentication and clinic authorization.
- Do not trust a client-supplied clinic code without verifying it against the authorized clinic ID.
- Scheduled jobs may use service credentials only for configured/entitled clinics.
- Minimize PII sent to model providers.
- Mask phone numbers in generic agent result tables. Reuse existing authorized customer detail views for permitted drill-down.
- Never log tokens, secrets, or unnecessary full customer data.

## Editing Rules

- Preserve ESM `.js` import suffixes in TypeScript files.
- Use Zod at API boundaries.
- Keep changes additive and compatible with existing reports, Customer Relationship Agent, GT Growth AI, and Telegram routes.
- Reuse existing services and components before adding new SQL or dependencies.
- Use fixed typed queries, parameterized variables, row limits, and timeouts.
- Do not edit secrets, real `.env` files, generated build output, or deployment credentials.
- Do not run broad dependency upgrades or `npm audit fix --force` during unrelated feature work.
