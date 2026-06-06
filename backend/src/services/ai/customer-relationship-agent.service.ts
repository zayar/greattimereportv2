import type { ZodType } from "zod";
import { z } from "zod";
import { env } from "../../config/env.js";
import { runCustomerRelationshipLearning } from "../reports/customer-relationship-learning.service.js";
import {
  getCustomerRelationshipProfileByKey,
  getLatestCustomerRelationshipLearningRun,
  markCustomerRelationshipProfilesMatched,
  saveCustomerRelationshipAgentInteraction,
  saveCustomerRelationshipFollowUp,
  searchCustomerRelationshipProfiles,
} from "../reports/customer-relationship-profile.repository.js";
import { resolveAiLanguage, type AiLanguage } from "./language.js";
import { createAiProvider } from "./provider.js";
import {
  buildCustomerRelationshipAgentPrompt,
  buildCustomerRelationshipFollowUpPrompt,
} from "./customer-relationship-prompts.js";
import { buildCustomerRelationshipEvidence } from "./customer-relationship-evidence.service.js";
import {
  customerRelationshipAgentAnswerSchema,
  customerRelationshipFeedbackOutcomes,
  customerRelationshipFollowUpMessageSchema,
  type CustomerRelationshipAgentResponse,
  type CustomerRelationshipAgentRow,
  type CustomerRelationshipEvidenceType,
  type CustomerRelationshipFeedbackOutcome,
  type CustomerRelationshipFollowUpMessage,
  type CustomerRelationshipFollowUpTone,
  type CustomerRelationshipIntent,
  type CustomerRelationshipProfile,
  type CustomerRelationshipRiskLevel,
  type CustomerRelationshipSegment,
} from "./customer-relationship-schemas.js";

const AGENT_ROW_LIMIT = 25;
const STALE_LEARNING_MS = 24 * 60 * 60_000;

type SearchToolPlan = {
  segment?: CustomerRelationshipSegment;
  riskLevel?: CustomerRelationshipRiskLevel;
  search?: string;
  sortBy?: "priorityScore" | "lastVisitDate" | "daysSinceLastVisit" | "lifetimeSpend" | "remainingPackageSessions";
  sortDirection?: "asc" | "desc";
};

function stripJsonFences(payload: string) {
  return payload.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
}

function formatZodIssue(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
}

async function getStructuredAiOutput<T>(params: {
  schema: ZodType<T>;
  prompt: string;
  fallbackReason: string;
}) {
  const provider = createAiProvider();
  if (!provider) {
    return {
      data: null,
      modelName: "gemini-fallback",
      fallbackReason: params.fallbackReason,
    };
  }

  try {
    const raw = await provider.generateJson(params.prompt);
    const parsedJson = JSON.parse(stripJsonFences(raw)) as unknown;
    const parsed = params.schema.safeParse(parsedJson);

    if (!parsed.success) {
      return {
        data: null,
        modelName: provider.modelName,
        fallbackReason: formatZodIssue(parsed.error),
      };
    }

    return {
      data: parsed.data,
      modelName: provider.modelName,
      fallbackReason: null,
    };
  } catch (error) {
    return {
      data: null,
      modelName: provider.modelName,
      fallbackReason: error instanceof Error ? error.message : "AI provider returned an invalid response.",
    };
  }
}

export function detectCustomerRelationshipIntent(question: string): CustomerRelationshipIntent {
  const normalized = question.trim().toLowerCase();

  if (!normalized) {
    return "general_summary";
  }

  if (/(never came|never visit|never visited|package.*မလာ|ဝယ်.*မလာ|မလာသေး)/i.test(normalized)) {
    return "package_bought_never_came";
  }

  if (/(balance|remaining|sessions left|renewal|renew|ကျန်|လက်ကျန်)/i.test(normalized)) {
    return "unused_package_balance";
  }

  if (/(not used|unused package|package.*not use|မသုံး|အသုံးမပြု)/i.test(normalized)) {
    return "package_bought_not_used";
  }

  if (/(follow up|follow-up|today|ဒီနေ့|ဆက်သွယ်)/i.test(normalized)) {
    return "follow_up_today";
  }

  if (/(inactive vip|vip.*inactive|vip.*မလာ|vip)/i.test(normalized)) {
    return "inactive_vip";
  }

  if (/(churn|risk|at risk|ဆုံးရှုံး|အန္တရာယ်)/i.test(normalized)) {
    return "churn_risk";
  }

  if (/(due|overdue|treatment due|return|ပြန်လာ|ကျော်)/i.test(normalized)) {
    return "treatment_due";
  }

  if (/(high value|high-value|big spender|spend.*recent|package.*recent)/i.test(normalized)) {
    return "high_value_no_recent_visit";
  }

  if (/(who is|find|search|customer|member|ရှာ)/i.test(normalized)) {
    return "customer_search";
  }

  if (/(summary|overall|overview|အကျဉ်း|ခြုံ)/i.test(normalized)) {
    return "general_summary";
  }

  return "unsupported";
}

function extractCustomerSearch(question: string) {
  const trimmed = question.trim();
  const quoted = trimmed.match(/"([^"]{2,80})"/)?.[1] ?? trimmed.match(/'([^']{2,80})'/)?.[1];
  if (quoted) {
    return quoted;
  }

  return trimmed
    .replace(/^(find|search|who is|customer|member)\s+/i, "")
    .trim()
    .slice(0, 80);
}

function buildToolPlan(intent: CustomerRelationshipIntent, question: string): SearchToolPlan | null {
  switch (intent) {
    case "package_bought_never_came":
      return { segment: "package_bought_never_came", sortBy: "priorityScore", sortDirection: "desc" };
    case "package_bought_not_used":
      return { segment: "package_bought_not_used", sortBy: "priorityScore", sortDirection: "desc" };
    case "unused_package_balance":
      return { segment: "unused_package_balance", sortBy: "remainingPackageSessions", sortDirection: "desc" };
    case "follow_up_today":
      return { sortBy: "priorityScore", sortDirection: "desc" };
    case "inactive_vip":
      return { segment: "inactive_vip", sortBy: "priorityScore", sortDirection: "desc" };
    case "churn_risk":
      return { riskLevel: "high", sortBy: "priorityScore", sortDirection: "desc" };
    case "treatment_due":
      return { segment: "treatment_due", sortBy: "priorityScore", sortDirection: "desc" };
    case "high_value_no_recent_visit":
      return { segment: "high_value_no_recent_visit", sortBy: "priorityScore", sortDirection: "desc" };
    case "customer_search":
      return { search: extractCustomerSearch(question), sortBy: "priorityScore", sortDirection: "desc" };
    case "general_summary":
      return { sortBy: "priorityScore", sortDirection: "desc" };
    default:
      return null;
  }
}

function toAgentRow(profile: CustomerRelationshipProfile): CustomerRelationshipAgentRow {
  return {
    customerKey: profile.customerKey,
    customerName: profile.customerName,
    customerPhoneMasked: profile.customerPhoneMasked,
    lastVisitDate: profile.lastVisitDate,
    daysSinceLastVisit: profile.daysSinceLastVisit,
    lastService: profile.lastService,
    lastPackageServiceName: profile.lastPackageServiceName,
    lastPackageName: profile.lastPackageName,
    remainingPackageSessions: profile.remainingPackageSessions,
    packageHoldings: profile.packageHoldings,
    packagePurchases: profile.packagePurchases,
    lifetimeSpend: profile.lifetimeSpend,
    riskLevel: profile.riskLevel,
    segments: profile.segments,
    reasons: profile.reasons,
    nextBestAction: profile.nextBestAction,
    priorityScore: profile.priorityScore,
    lastFollowUpAt: profile.lastFollowUpAt,
    lastFollowUpOutcome: profile.lastFollowUpOutcome,
    followUpCount: profile.followUpCount,
  };
}

export function selectCustomerRelationshipEvidenceType(intent: CustomerRelationshipIntent): CustomerRelationshipEvidenceType {
  switch (intent) {
    case "package_bought_never_came":
    case "package_bought_not_used":
    case "unused_package_balance":
      return "package_usage";
    case "treatment_due":
      return "visit_pattern";
    case "churn_risk":
    case "inactive_vip":
    case "high_value_no_recent_visit":
      return "risk_explanation";
    default:
      return "none";
  }
}

function buildDataFreshnessNote(params: {
  learnedAt: string | null;
  sourceLookbackDays: number | null;
  profileCount: number;
}) {
  if (!params.learnedAt) {
    return "Customer behavior has not been learned yet. Run learning first to answer from profile data.";
  }

  return `Learned from ${params.profileCount.toLocaleString("en-US")} customer profile${params.profileCount === 1 ? "" : "s"} on ${params.learnedAt}; source lookback ${params.sourceLookbackDays ?? "unknown"} days.`;
}

function buildUnsupportedAnswer(): CustomerRelationshipAgentResponse {
  return {
    detectedIntent: "unsupported",
    answerSummary:
      "I can answer safe customer relationship questions after learning profiles, but I cannot run arbitrary SQL or guess from raw data.",
    reasonBullets: [
      "The question is outside the supported customer relationship intents.",
      "No profile search was run, so there is no customer evidence to display.",
    ],
    evidenceNarrative: "Ask a supported relationship question after customer behavior learning has run.",
    matchedCount: 0,
    recommendedActions: [
      "Try: Who bought package but never came?",
      "Try: Which customers have unused package balance?",
      "Try: Which VIP customers are inactive?",
    ],
    rows: [],
    dataFreshnessNote: "No profile search was run because the question is outside the supported V1 intents.",
    learnedAt: null,
    sourceLookbackDays: null,
    nextQuestionSuggestions: [
      "Who bought package but never came?",
      "Which customers should we follow up today?",
      "Which customers are at risk of churn?",
    ],
    suggestions: [
      "Who bought package but never came?",
      "Which customers should we follow up today?",
      "Which customers are at risk of churn?",
    ],
    usedFallback: true,
  };
}

export function buildFallbackAgentCopy(params: {
  intent: CustomerRelationshipIntent;
  rows: CustomerRelationshipAgentRow[];
  matchedCount: number;
  dataFreshnessNote: string;
  aiLanguage: AiLanguage;
}) {
  const first = params.rows[0];
  const intentLabel = params.intent.replace(/_/g, " ");
  const reasonBullets = first
    ? first.reasons.slice(0, 4)
    : ["No matched customers were found for the selected intent."];
  const evidenceNarrative = first
    ? `${first.customerName} is the top matched customer. The priority is based on learned profile reasons and the sorted customer list.`
    : "No customer evidence is available for this answer. Refresh learning if the data looks stale.";
  const nextQuestionSuggestions = [
    "Which customers have unused package balance?",
    "Which customers are at risk?",
    "Who should we follow up today?",
  ];

  if (params.aiLanguage === "my-MM") {
    return {
      answerSummary: first
        ? `${intentLabel} အတွက် customer ${params.matchedCount.toLocaleString("en-US")} ယောက်တွေ့ပါတယ်။ Priority အမြင့်ဆုံးက ${first.customerName} ဖြစ်ပြီး ${first.reasons[0] ?? "profile rule အရ follow-up လုပ်သင့်ပါတယ်"}`
        : `${intentLabel} အတွက် customer မတွေ့သေးပါ။ Learning data ကို refresh လုပ်ပြီး ပြန်စစ်နိုင်ပါတယ်။`,
      recommendedActions: [
        first?.nextBestAction ?? "Refresh customer behavior learning and review the priority list.",
        "Record follow-up feedback after the team contacts the customer.",
      ],
      reasonBullets,
      evidenceNarrative,
      nextQuestionSuggestions,
    };
  }

  return {
    answerSummary: first
      ? `${params.matchedCount.toLocaleString("en-US")} customer${params.matchedCount === 1 ? "" : "s"} matched ${intentLabel}. Top priority is ${first.customerName}: ${first.reasons[0] ?? "profile rules recommend follow-up."}`
      : `No customers matched ${intentLabel}. Refresh learning if the data looks stale.`,
    recommendedActions: [
      first?.nextBestAction ?? "Refresh customer behavior learning and review the priority list.",
      "Record follow-up feedback after the team contacts the customer.",
      params.dataFreshnessNote,
    ].slice(0, 3),
    reasonBullets,
    evidenceNarrative,
    nextQuestionSuggestions,
  };
}

async function ensureLearningIfNeeded(params: {
  clinicId: string;
  clinicCode: string;
  autoLearnIfStale?: boolean;
}) {
  let latestRun = await getLatestCustomerRelationshipLearningRun(params.clinicId);
  const learnedTime = latestRun?.learnedAt ? new Date(latestRun.learnedAt).getTime() : 0;
  const stale = !learnedTime || Date.now() - learnedTime > STALE_LEARNING_MS;

  if (params.autoLearnIfStale && stale) {
    await runCustomerRelationshipLearning({
      clinicId: params.clinicId,
      clinicCode: params.clinicCode,
      lookbackDays: 365,
    });
    latestRun = await getLatestCustomerRelationshipLearningRun(params.clinicId);
  }

  return latestRun;
}

export async function askCustomerRelationshipAgent(params: {
  clinicId: string;
  clinicCode: string;
  question: string;
  aiLanguage?: AiLanguage;
  autoLearnIfStale?: boolean;
}): Promise<CustomerRelationshipAgentResponse> {
  const aiLanguage = resolveAiLanguage(params.aiLanguage, resolveAiLanguage(env.AI_DEFAULT_LANGUAGE));
  const intent = detectCustomerRelationshipIntent(params.question);
  const plan = buildToolPlan(intent, params.question);

  if (!plan) {
    return buildUnsupportedAnswer();
  }

  const latestRun = await ensureLearningIfNeeded({
    clinicId: params.clinicId,
    clinicCode: params.clinicCode,
    autoLearnIfStale: params.autoLearnIfStale,
  });
  const result = await searchCustomerRelationshipProfiles({
    clinicId: params.clinicId,
    segment: plan.segment,
    riskLevel: plan.riskLevel,
    search: plan.search,
    sortBy: plan.sortBy,
    sortDirection: plan.sortDirection,
    limit: AGENT_ROW_LIMIT,
    offset: 0,
  });
  const rows = result.rows.map(toAgentRow);
  const evidenceType = selectCustomerRelationshipEvidenceType(intent);
  const dataFreshnessNote = buildDataFreshnessNote({
    learnedAt: latestRun?.learnedAt ?? null,
    sourceLookbackDays: latestRun?.sourceLookbackDays ?? null,
    profileCount: latestRun?.profilesSaved ?? result.totalCount,
  });

  await Promise.all([
    saveCustomerRelationshipAgentInteraction({
      clinicId: params.clinicId,
      clinicCode: params.clinicCode,
      question: params.question.trim().slice(0, 500),
      detectedIntent: intent,
      matchedCount: result.totalCount,
    }),
    markCustomerRelationshipProfilesMatched({
      clinicId: params.clinicId,
      customerKeys: rows.map((row) => row.customerKey),
      intent,
    }),
  ]);

  const fallbackCopy = buildFallbackAgentCopy({
    intent,
    rows,
    matchedCount: result.totalCount,
    dataFreshnessNote,
    aiLanguage,
  });
  const evidence =
    rows.length > 0 && evidenceType !== "none"
      ? await buildCustomerRelationshipEvidence({
          clinicId: params.clinicId,
          clinicCode: params.clinicCode,
          customerKey: rows[0].customerKey,
          evidenceType,
        })
      : null;
  const aiResult = await getStructuredAiOutput({
    schema: customerRelationshipAgentAnswerSchema,
    prompt: buildCustomerRelationshipAgentPrompt({
      aiLanguage,
      question: params.question,
      detectedIntent: intent,
      matchedCount: result.totalCount,
      rows,
      evidence,
      dataFreshnessNote,
    }),
    fallbackReason: "Gemini is not configured for Customer Relationship Agent.",
  });
  const copy = aiResult.data ?? fallbackCopy;
  const recommendedActions =
    copy.recommendedActions && copy.recommendedActions.length > 0
      ? copy.recommendedActions
      : fallbackCopy.recommendedActions;
  const nextQuestionSuggestions =
    copy.nextQuestionSuggestions && copy.nextQuestionSuggestions.length > 0
      ? copy.nextQuestionSuggestions
      : fallbackCopy.nextQuestionSuggestions;
  const reasonBullets =
    copy.reasonBullets && copy.reasonBullets.length > 0 ? copy.reasonBullets : fallbackCopy.reasonBullets;

  return {
    detectedIntent: intent,
    answerSummary: copy.answerSummary,
    reasonBullets,
    evidenceNarrative: copy.evidenceNarrative || fallbackCopy.evidenceNarrative,
    matchedCount: result.totalCount,
    recommendedActions: recommendedActions.slice(0, 4),
    rows,
    evidence,
    dataFreshnessNote,
    learnedAt: latestRun?.learnedAt ?? null,
    sourceLookbackDays: latestRun?.sourceLookbackDays ?? null,
    nextQuestionSuggestions: nextQuestionSuggestions.slice(0, 4),
    suggestions: nextQuestionSuggestions.slice(0, 4),
    usedFallback: aiResult.data == null,
  };
}

function buildFallbackFollowUpMessage(params: {
  aiLanguage: AiLanguage;
  profile: CustomerRelationshipProfile;
}) {
  const service = params.profile.preferredService ?? params.profile.lastService ?? "service";

  if (params.aiLanguage === "my-MM") {
    const packageText =
      params.profile.remainingPackageSessions > 0
        ? ` ${params.profile.remainingPackageSessions} session လေးတွေ ကျန်နေသေးလို့`
        : "";
    return {
      message: `မင်္ဂလာပါ ${params.profile.customerName} ရေ။${packageText} ဒီအပတ် ${service} appointment ပြန်ယူချင်ရင် အချိန်လေး ကူညီစီစဉ်ပေးပါမယ်ရှင့်။`,
      reason: params.profile.reasons[0] ?? "Customer profile suggests a gentle follow-up.",
    };
  }

  return {
    message: `Hi ${params.profile.customerName}, we noticed you may be due for your next ${service} visit. If you would like, we can help arrange a convenient appointment this week.`,
    reason: params.profile.reasons[0] ?? "Customer profile suggests a gentle follow-up.",
  };
}

export async function generateCustomerRelationshipFollowUpMessage(params: {
  clinicId: string;
  customerKey: string;
  aiLanguage?: AiLanguage;
  tone?: CustomerRelationshipFollowUpTone;
}): Promise<CustomerRelationshipFollowUpMessage> {
  const aiLanguage = resolveAiLanguage(params.aiLanguage, resolveAiLanguage(env.AI_DEFAULT_LANGUAGE));
  const profile = await getCustomerRelationshipProfileByKey({
    clinicId: params.clinicId,
    customerKey: params.customerKey,
  });

  if (!profile) {
    throw new Error("Customer relationship profile not found. Run learning first.");
  }

  const fallback = buildFallbackFollowUpMessage({ aiLanguage, profile });
  const aiResult = await getStructuredAiOutput({
    schema: customerRelationshipFollowUpMessageSchema,
    prompt: buildCustomerRelationshipFollowUpPrompt({
      aiLanguage,
      tone: params.tone ?? "friendly",
      profile,
    }),
    fallbackReason: "Gemini is not configured for follow-up message generation.",
  });
  const copy = aiResult.data ?? fallback;

  return {
    message: copy.message,
    reason: copy.reason,
    customerName: profile.customerName,
    segments: profile.segments,
    languageUsed: aiLanguage,
    usedFallback: aiResult.data == null,
  };
}

export async function recordCustomerRelationshipFeedback(params: {
  clinicId: string;
  clinicCode: string;
  customerKey: string;
  outcome: CustomerRelationshipFeedbackOutcome;
  note?: string | null;
}) {
  if (!customerRelationshipFeedbackOutcomes.includes(params.outcome)) {
    throw new Error("Unsupported customer relationship follow-up outcome.");
  }

  await saveCustomerRelationshipFollowUp(params);
  const profile = await getCustomerRelationshipProfileByKey({
    clinicId: params.clinicId,
    customerKey: params.customerKey,
  });

  return profile;
}
