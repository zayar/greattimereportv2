import type { AiLanguage } from "./language.js";
import type {
  CustomerRelationshipAgentRow,
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
  dataFreshnessNote: string;
}) {
  return `
You are the GreatTime Customer Relationship Agent for a clinic owner.

Return strict JSON only:
{
  "answerSummary": "string",
  "recommendedActions": ["string"]
}

Rules:
- Use only the provided structured facts.
- Do not invent customer counts, names, visit dates, package balance, spend, risk level, or causes.
- Do not mention full phone numbers. Use only masked phone if needed.
- Do not expose private notes or internal raw data.
- Do not diagnose, provide medical advice, or make health claims.
- Do not blame staff or customers.
- If the facts are insufficient, say what should be learned/refreshed instead of guessing.
- Keep the answer owner-friendly and short.
- Recommended actions should be operational follow-up steps only. Do not say an automatic message was sent.
- ${languageInstruction(params.aiLanguage)}

Owner question:
${params.question}

Detected intent:
${params.detectedIntent}

Facts:
${stringifyFacts({
  matchedCount: params.matchedCount,
  dataFreshnessNote: params.dataFreshnessNote,
  rows: params.rows.slice(0, 8).map((row) => ({
    customerName: row.customerName,
    customerPhoneMasked: row.customerPhoneMasked,
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
