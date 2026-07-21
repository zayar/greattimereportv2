# Consultant Agent — The Queen Preview

## Scope

The Consultant Agent is implemented only in `GT_V2Report`. It does not change the
`gt.apicore` codebase or database schema.

During this preview:

- The specialization is visible only when the selected clinic code is `GTTHEQUEEN`.
- Staff must explicitly select **Service consultant** in Agent Workspace.
- Booking actions are disabled.
- Advice uses only published GT V2 knowledge.
- Current service price, duration, status, and description are read from the existing
  GT API Core GraphQL service catalog.
- Trending services come from the existing BigQuery service behavior report.

## Source ownership

| Data | Source of truth |
| --- | --- |
| Active service, description, price, duration | GT API Core, read-only |
| Consultation guidance and translations | GT V2 Firestore |
| Historical service popularity | BigQuery |
| Agent sessions, traces, and feedback | Existing GT V2 Firestore repositories |

The Firestore collections introduced by this feature are:

- `gtConsultantServiceKnowledgeV1` — current draft plus the last published content.
- `gtConsultantServiceKnowledgeVersionsV1` — immutable draft-save and publish revisions.

Prices are intentionally not copied into Firestore.

## GPT-5.6 knowledge suggestions

The knowledge editor can request a bilingual draft from `gpt-5.6-sol` through the
OpenAI Responses API. This authoring helper is separate from the existing Gemini
provider used elsewhere in GT V2.

- The backend sends only the selected API Core service description, duration, and the
  current editor content. It does not send customer records.
- The request uses strict structured output, medium reasoning, and `store: false`.
- Generation runs as an OpenAI background response and is polled through an authenticated
  GT V2 route, avoiding one long-lived browser request.
- Suggestions return English and Myanmar content plus confidence, warnings, missing
  information, and review notes.
- The response changes only the browser form. It does not write Firestore or publish.
- The editor shows queued/in-progress status beside the button and stops polling with an
  actionable error after four minutes.
- API Core price remains live and is explicitly excluded from generated knowledge.
- The endpoint is restricted to an authorized Queen clinic and AI Control Panel admins.
- `OPENAI_API_KEY` is a backend-only GitHub Actions secret passed to Cloud Run. It must
  never be added to frontend variables, Firestore, source code, or logs.

## Publishing workflow

1. An AI Control Panel admin opens `/ai/consultant-knowledge`.
2. The page loads active services and live prices from GT API Core.
3. The admin writes English and/or Myanmar consultation knowledge.
4. **Save draft** creates a version without changing agent answers.
5. **Publish for Consultant** copies the reviewed draft into the published content.
6. Agent tools read only published content.

Publishing requires at least one complete language with:

- overview;
- concern tags;
- suitability guidance or benefits;
- a safety boundary (not-suitable, limitations, or escalation rules); and
- consultation questions.

Optimistic version checks prevent one editor from overwriting another editor's newer
draft.

## Response safety

- The general semantic planner does not choose Consultant during the preview.
- Concern matching is deterministic and runs against approved tags and aliases.
- One incidental shared word is insufficient to match a service.
- A named service without published knowledge can show only API Core facts; it cannot
  claim personal suitability.
- Urgent symptom wording suppresses cosmetic recommendations and advises qualified
  medical assessment.
- Every response remains read-only and records that no GreatTime operational data was
  changed.

## Rollout checklist

1. Confirm the deployment can access the existing Firebase/Firestore project.
2. Confirm GT API Core GraphQL credentials can run the fixed `services` query.
3. Confirm `gt_growth_ai` is enabled for The Queen clinic ID.
4. Confirm knowledge editors are included in `GT_GROWTH_AI_ADMIN_EMAILS` and the matching
   frontend admin configuration.
5. Add and review knowledge for a small pilot set of Queen services.
6. Test dry skin, facial hair, sun exposure, named-service, trending, no-match, and urgent
   symptom cases in Agent Workspace.
7. Review feedback and traces before enabling any Queen-app customer surface.
