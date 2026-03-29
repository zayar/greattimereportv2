import type { AiLanguage } from "./language.js";

function languageInstruction(language: AiLanguage) {
  if (language === "my-MM") {
    return "Write in simple, natural Myanmar language for clinic business owners. Keep it concise and easy to act on.";
  }

  return "Write in simple professional English for clinic business owners. Keep it concise and easy to act on.";
}

function baseRulesBlock() {
  return [
    "Use only the facts provided.",
    "Do not invent numbers, percentages, trends, or causes.",
    "Do not mention data that is not present in the facts.",
    "Keep the wording business-focused.",
    "No medical diagnosis, no medical advice, and no treatment recommendation.",
    "Return strict JSON only with no markdown fences.",
  ].join("\n- ");
}

function serializeFacts(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function buildExecutiveSummaryPrompt(params: {
  aiLanguage: AiLanguage;
  facts: unknown;
}) {
  return `
You are writing an executive dashboard summary for GT_V2Report.

Language instruction:
${languageInstruction(params.aiLanguage)}

Rules:
- ${baseRulesBlock()}

Return this JSON shape:
{
  "summaryTitle": "string",
  "summaryText": "string",
  "topFindings": ["string"],
  "recommendedActions": ["string"],
  "warningText": "string | null"
}

Additional constraints:
- summaryTitle: 2 to 6 words.
- summaryText: 1 to 3 short sentences.
- topFindings: maximum 3 items.
- recommendedActions: maximum 3 items.
- warningText: null when no warning is needed.

Facts:
${serializeFacts(params.facts)}
  `.trim();
}

export function buildCustomerInsightPrompt(params: {
  aiLanguage: AiLanguage;
  facts: unknown;
}) {
  return `
You are acting like a clinic growth manager reviewing one exact customer record inside GT_V2Report.

Language instruction:
${languageInstruction(params.aiLanguage)}

Rules:
- ${baseRulesBlock()}
- The deterministic signals are already calculated. Use them to guide the explanation, but do not change them.
- Do not just repeat visible labels, badges, or raw metrics.
- Do not lean on internal wording like health score, churn risk, or rebooking status unless the facts make it necessary.
- Describe this customer as a real commercial relationship: who they are, what they mean to the clinic, what pattern is visible, what risk or dependency exists, and what the team should do next.
- Focus on interpretation, not metric restatement.

Return this JSON shape:
{
  "customerArchetype": "string",
  "ownerSummary": "string",
  "businessMeaning": "string",
  "relationshipNote": "string",
  "riskNote": "string | null",
  "opportunityNote": "string | null",
  "recommendedAction": "string",
  "suggestedFollowUpMessage": "string | null"
}

Additional constraints:
- customerArchetype: 3 to 7 words, business style, for example a customer type or relationship archetype.
- ownerSummary: 1 to 2 short sentences on who this customer is overall.
- businessMeaning: 1 short sentence on the commercial meaning of this customer to the clinic.
- relationshipNote: 1 short sentence on therapist, service, package, or visit pattern.
- riskNote: null when there is no meaningful current risk or dependency.
- opportunityNote: null when there is no clear current opportunity.
- recommendedAction: one concrete clinic-team action statement.
- suggestedFollowUpMessage: optional, short, friendly, business-safe, and suitable for front desk follow-up.
- Make every field feel specific to this customer record.
- Do not include any diagnosis, clinical claim, or treatment advice.

Facts:
${serializeFacts(params.facts)}
  `.trim();
}

export function buildServiceInsightPrompt(params: {
  aiLanguage: AiLanguage;
  facts: unknown;
}) {
  return `
You are writing a short service performance insight for GT_V2Report.

Language instruction:
${languageInstruction(params.aiLanguage)}

Rules:
- ${baseRulesBlock()}
- Focus on service demand, repeat behavior, package opportunity, staffing concentration, and business actions.

Return this JSON shape:
{
  "shortSummary": "string",
  "growthInsight": "string",
  "repeatRateInsight": "string",
  "packageOpportunity": "string",
  "staffingObservation": "string | null",
  "recommendedActions": ["string"]
}

Additional constraints:
- Every value must stay short and actionable.
- recommendedActions: maximum 3 items.
- staffingObservation: null when staffing concentration is not notable.

Facts:
${serializeFacts(params.facts)}
  `.trim();
}

export function buildCorrectionPrompt(params: {
  originalPrompt: string;
  invalidResponse: string;
  validationIssue: string;
}) {
  return `
The previous response did not match the required JSON format.

Validation issue:
${params.validationIssue}

Previous invalid response:
${params.invalidResponse}

Fix the response now.
Return strict JSON only with no markdown fences.

Original instructions:
${params.originalPrompt}
  `.trim();
}
