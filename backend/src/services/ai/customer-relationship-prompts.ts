import type { AiLanguage } from "./language.js";
import type {
  CustomerRelationshipAgentRow,
  CustomerRelationshipEvidence,
  CustomerRelationshipFollowUpTone,
  CustomerRelationshipIntent,
  CustomerRelationshipProfile,
} from "./customer-relationship-schemas.js";

function languageInstruction(aiLanguage: AiLanguage) {
  return aiLanguage === "my-MM"
    ? "Write JSON values in Myanmar-friendly language. Keep JSON keys in English."
    : "Write JSON values in English. Keep JSON keys in English.";
}

function stringifyFacts(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function buildCustomerRelationshipAgentPrompt(params: {
  aiLanguage: AiLanguage;
  question: string;
  detectedIntent: CustomerRelationshipIntent;
  matchedCount: number;
  rows: CustomerRelationshipAgentRow[];
  evidence?: CustomerRelationshipEvidence | null;
  dataFreshnessNote: string;
}) {
  return `
You are the GreatTime Customer Relationship Intelligence Agent for a clinic owner.

Return strict JSON only:
{
  "answerSummary": "string",
  "reasonBullets": ["string"],
  "evidenceNarrative": "string",
  "recommendedActions": ["string"],
  "nextQuestionSuggestions": ["string"]
}

Rules:
- Use only the provided structured facts.
- Do not invent customer counts, customer names, visit dates, package balances, spend amounts, risk levels, or reasons.
- Do not mention full phone numbers. Use only masked phone if needed.
- Do not expose private notes or internal raw data.
- Never expose internal terms such as "bounded customer match", "ambiguous match", "resolver", "database", or "agent will not silently choose".
- Speak like a helpful salon/customer-service assistant, not a technical system.
- Prefer recent appointment context when it is provided; do not search globally again when a selected appointment/customer is already identified.
- When uncertain, ask the owner to tap a button or choose a number.
- Do not create generic "Next Question 1/2/3" buttons or generic numbered follow-up labels. Use clear actions only, such as Full History, Package / Balance, Back to Customer, or Back to Today Appointments.
- Keep replies short and action-oriented.
- Support Burmese + English mixed messages when the owner uses mixed language.
- Do not diagnose, give medical advice, or make health guarantees.
- Do not blame staff or customers.
- Keep the explanation business-owner friendly.
- Explain why the selected customers need attention.
- Refer to visual evidence only when the evidence object is provided.
- Recommended actions must be operational actions only: call, message, review, book, record follow-up.
- Do not say that a message was already sent.
- If package usage confidence is low, describe it as "usage could not be confirmed" rather than confirmed non-usage.
- If facts are insufficient, say what data should be refreshed.
- Keep JSON keys in English.
- ${languageInstruction(params.aiLanguage)}

Owner question:
${params.question}

Detected intent:
${params.detectedIntent}

Matched count:
${params.matchedCount}

Data freshness:
${params.dataFreshnessNote}

Top matched customers:
${stringifyFacts({
  rows: params.rows.slice(0, 8).map((row) => ({
    customerName: row.customerName,
    customerPhoneMasked: row.customerPhoneMasked,
    segmentLabel: row.segmentLabel,
    primarySegment: row.primarySegment,
    packageOrServiceName: row.packageOrServiceName,
    purchaseDate: row.purchaseDate,
    firstMatchingUsageDate: row.firstMatchingUsageDate,
    lastMatchingUsageDate: row.lastMatchingUsageDate,
    remainingSessions: row.remainingSessions,
    balanceStatus: row.balanceStatus,
    evidenceReason: row.evidenceReason,
    lastService: row.lastService,
    lastPackageServiceName: row.lastPackageServiceName,
    lastPackageName: row.lastPackageName,
    daysSinceLastVisit: row.daysSinceLastVisit,
    lastVisitDate: row.lastVisitDate,
    remainingPackageSessions: row.remainingPackageSessions,
    lifetimeSpend: row.lifetimeSpend,
    riskLevel: row.riskLevel,
    segments: row.segments,
    reasons: row.reasons.slice(0, 3),
    nextBestAction: row.nextBestAction,
    priorityScore: row.priorityScore,
  })),
})}

Evidence:
${stringifyFacts(params.evidence ?? null)}
  `.trim();
}

export function buildCustomerRelationshipFollowUpPrompt(params: {
  aiLanguage: AiLanguage;
  tone: CustomerRelationshipFollowUpTone;
  profile: CustomerRelationshipProfile;
}) {
  return `
You write a suggested follow-up message from a clinic to one customer.

Return strict JSON only:
{
  "message": "string",
  "reason": "string"
}

Rules:
- Use only the provided customer relationship facts.
- Keep the message short, friendly, and not pushy.
- Do not mention churn risk, risk score, priority score, segmentation, or internal analysis to the customer.
- Do not mention full phone numbers.
- Do not promise discounts, promotions, or booking slots unless the facts explicitly say so.
- Do not give medical advice, diagnosis, treatment claims, or health guarantees.
- The reason is for the owner, not the customer.
- Tone: ${params.tone}.
- ${languageInstruction(params.aiLanguage)}

Customer facts:
${stringifyFacts({
  customerName: params.profile.customerName,
  customerPhoneMasked: params.profile.customerPhoneMasked,
  lastVisitDate: params.profile.lastVisitDate,
  daysSinceLastVisit: params.profile.daysSinceLastVisit,
  preferredService: params.profile.preferredService,
  preferredServiceCategory: params.profile.preferredServiceCategory,
  lastService: params.profile.lastService,
  remainingPackageSessions: params.profile.remainingPackageSessions,
  lastPackagePurchaseDate: params.profile.lastPackagePurchaseDate,
  segments: params.profile.segments,
  reasons: params.profile.reasons.slice(0, 4),
  nextBestAction: params.profile.nextBestAction,
})}
  `.trim();
}
