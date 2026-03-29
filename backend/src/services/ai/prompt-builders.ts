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
You are writing a short customer retention insight for GT_V2Report.

Language instruction:
${languageInstruction(params.aiLanguage)}

Rules:
- ${baseRulesBlock()}
- The risk labels and health score are already calculated deterministically. Do not change them.
- Explain the current rebooking and churn situation in plain business language.

Return this JSON shape:
{
  "nextBestAction": "string",
  "shortExplanation": "string",
  "suggestedFollowUpMessage": "string | null"
}

Additional constraints:
- shortExplanation: 1 to 3 short sentences.
- nextBestAction: one short action statement.
- suggestedFollowUpMessage: optional, short, friendly, and business-safe.
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
