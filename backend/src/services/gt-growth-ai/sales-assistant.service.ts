import { createHash } from "node:crypto";
import { env } from "../../config/env.js";
import { firestoreDb } from "../../config/firebase.js";
import { GT_GROWTH_AI_FEATURE_GATE } from "../../types/report-ai.js";
import {
  gtGrowthAiSalesActionStatuses,
  type GtGrowthAiActionPriority,
  type GtGrowthAiSalesAction,
  type GtGrowthAiSalesActionEvidence,
  type GtGrowthAiSalesActionStatus,
  type GtGrowthAiSalesActionType,
  type GtGrowthAiSalesActionUpdateStatus,
  type GtGrowthAiSalesAssistantProgress,
  type GtGrowthAiSalesAssistantResponse,
  type GtGrowthAiSalesAssistantSummary,
  type GtGrowthAiTelegramTargetPurpose,
} from "../../types/gt-growth-ai-sales-assistant.js";
import { hasFeatureAccess } from "../feature-access.service.js";
import { getCustomerPortalList } from "../reports/customer-portal.service.js";
import { getPackagePortalReport } from "../reports/package-portal.service.js";
import { getPaymentReport } from "../reports/payment-report.service.js";
import { getTelegramIntegrationStatus } from "../telegram/storage.service.js";
import { formatDateKeyInTimeZone, normalizeTimeZone } from "../telegram/time.js";
import { getTodayAppointmentsForClinic } from "../telegram/report.service.js";
import type { ApicoreBookingDetailsRow } from "../apicore.service.js";
import type { TelegramTargetStatus } from "../telegram/types.js";

const ACTIONS_COLLECTION = "gt_growth_ai_sales_actions";
const TASK_SESSIONS_COLLECTION = "gt_growth_ai_telegram_task_sessions";
const DEFAULT_ACTION_LIMIT = 40;
const TELEGRAM_TASK_LIMIT = 10;
const TASK_SESSION_TTL_HOURS = 20;
const COMPLETED_STATUSES = new Set(["CHECKOUT", "CHECKED_OUT"]);

type BuildActionFactsInput = {
  clinicId: string;
  clinicCode?: string;
  dateKey: string;
  completedAppointments?: Array<{
    customerName: string;
    customerPhone?: string | null;
    memberId?: string | null;
    serviceName?: string | null;
    therapistName?: string | null;
    paymentAmount?: number | null;
  }>;
  packageFollowUps?: Array<{
    customerName: string;
    customerPhone?: string | null;
    memberId?: string | null;
    packageName: string;
    purchasedUnits?: number | null;
    usedUnits?: number | null;
    remainingUnits?: number | null;
    lastVisitDate?: string | null;
    daysSinceActivity?: number | null;
    therapist?: string | null;
  }>;
  packageUpsells?: Array<{
    customerName: string;
    memberId?: string | null;
    recentVisitCount: number;
    recentSpend?: number | null;
    repeatedService?: string | null;
    averageInvoiceValue?: number | null;
  }>;
  inactiveVipCustomers?: Array<{
    customerName: string;
    memberId?: string | null;
    lifetimeSpend?: number | null;
    averageSpend?: number | null;
    visitCount?: number | null;
    lastVisitDate?: string | null;
    daysSinceLastVisit?: number | null;
    preferredService?: string | null;
    preferredTherapist?: string | null;
  }>;
  paymentFollowUps?: Array<{
    customerName: string;
    memberId?: string | null;
    invoiceNumber: string;
    outstandingAmount: number;
    paymentStatus?: string | null;
    lastPaymentDate?: string | null;
  }>;
};

type ScoreInput = {
  actionType: GtGrowthAiSalesActionType;
  estimatedValue?: number | null;
  customerImportance: "vip" | "repeat" | "recent" | "standard";
  confidence: "strong" | "moderate" | "weak";
};

type SendPlan = {
  dateKey: string;
  actions: GtGrowthAiSalesAction[];
  summary: GtGrowthAiSalesAssistantSummary;
  salesTarget: TelegramTargetStatus | null;
  ownerTarget: TelegramTargetStatus | null;
  salesMessage: string | null;
  ownerMessage: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

function actionCollection() {
  return firestoreDb().collection(ACTIONS_COLLECTION);
}

function taskSessionCollection() {
  return firestoreDb().collection(TASK_SESSIONS_COLLECTION);
}

function hashId(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 24);
}

function buildActionId(dedupeKey: string) {
  return `gta_${hashId(dedupeKey)}`;
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeDateKey(value: string | null | undefined, timezone = env.DEFAULT_TIMEZONE) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return formatDateKeyInTimeZone(new Date(), normalizeTimeZone(timezone));
}

function parseNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value: string | null | undefined, fallback = "") {
  const text = (value ?? "").trim();
  return text || fallback;
}

function customerKey(input: { customerName?: string | null; memberId?: string | null; phone?: string | null }) {
  const memberId = cleanText(input.memberId);
  if (memberId) {
    return `member:${memberId}`;
  }

  const digits = cleanText(input.phone).replace(/\D/g, "");
  if (digits) {
    return `phone:${hashId(digits)}`;
  }

  const name = cleanText(input.customerName).toLowerCase();
  return name ? `name:${name}` : "unknown";
}

function maskPhone(value: string | null | undefined) {
  const digits = cleanText(value).replace(/\D/g, "");
  if (!digits) {
    return undefined;
  }

  return `***${digits.slice(-4)}`;
}

function moneyLabel(value: number | null | undefined) {
  if (value == null || value <= 0) {
    return null;
  }

  return `${Math.round(value).toLocaleString("en-US")} MMK`;
}

function priorityFromScore(score: number): GtGrowthAiActionPriority {
  if (score >= 75) {
    return "high";
  }

  if (score >= 45) {
    return "medium";
  }

  return "low";
}

export function calculateSalesAssistantPriorityScore(input: ScoreInput) {
  const value = input.estimatedValue ?? null;
  const valueScore =
    value == null
      ? 10
      : value >= 1_000_000
        ? 35
        : value >= 500_000
          ? 25
          : value >= 100_000
            ? 15
            : 10;
  const urgencyScore =
    input.actionType === "payment_follow_up" || input.actionType === "inactive_vip_follow_up"
      ? 25
      : input.actionType === "rebooking_opportunity" || input.actionType === "package_usage_follow_up"
        ? 20
        : 10;
  const customerImportanceScore =
    input.customerImportance === "vip"
      ? 25
      : input.customerImportance === "repeat"
        ? 15
        : input.customerImportance === "recent"
          ? 10
          : 5;
  const confidenceScore = input.confidence === "strong" ? 15 : input.confidence === "moderate" ? 10 : 5;

  return valueScore + urgencyScore + customerImportanceScore + confidenceScore;
}

function buildBaseAction(input: {
  clinicId: string;
  clinicCode?: string;
  dateKey: string;
  actionType: GtGrowthAiSalesActionType;
  customerName?: string;
  phoneMasked?: string;
  memberId?: string | null;
  customerKey?: string;
  dedupeSuffix: string;
  title: string;
  summary: string;
  reason: string;
  recommendedAction: string;
  evidence: GtGrowthAiSalesActionEvidence[];
  estimatedValue?: number | null;
  estimatedValueLabel?: string;
  source: GtGrowthAiSalesAction["source"];
  suggestedMessage: GtGrowthAiSalesAction["suggestedMessage"];
  score: ScoreInput;
}): GtGrowthAiSalesAction {
  const dedupeKey = `${input.clinicId}|${input.dateKey}|${input.actionType}|${input.dedupeSuffix}`;
  const priorityScore = calculateSalesAssistantPriorityScore({
    ...input.score,
    estimatedValue: input.estimatedValue,
  });
  const timestamp = nowIso();

  return {
    id: buildActionId(dedupeKey),
    clinicId: input.clinicId,
    clinicCode: input.clinicCode,
    dateKey: input.dateKey,
    actionType: input.actionType,
    priority: priorityFromScore(priorityScore),
    priorityScore,
    title: input.title,
    summary: input.summary,
    reason: input.reason,
    recommendedAction: input.recommendedAction,
    customer: {
      customerKey: input.customerKey,
      customerName: input.customerName,
      phoneMasked: input.phoneMasked,
      memberId: cleanText(input.memberId) || undefined,
    },
    evidence: input.evidence,
    suggestedMessage: input.suggestedMessage,
    ...(input.estimatedValue != null && input.estimatedValue > 0
      ? {
          estimatedValue: input.estimatedValue,
          currency: "MMK" as const,
        }
      : {
          estimatedValueLabel: input.estimatedValueLabel,
        }),
    source: input.source,
    status: "new",
    statusNote: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    assignedAt: null,
    lastStatusAt: null,
    lastStatusByTelegramUserId: null,
  };
}

export function buildSalesAssistantActionsFromFacts(input: BuildActionFactsInput) {
  const actions: GtGrowthAiSalesAction[] = [];

  for (const row of input.completedAppointments ?? []) {
    const name = cleanText(row.customerName, "Customer");
    const serviceName = cleanText(row.serviceName, "recent treatment");
    const key = customerKey({ customerName: name, memberId: row.memberId, phone: row.customerPhone });
    const estimatedValue = row.paymentAmount != null && row.paymentAmount > 0 ? row.paymentAmount : null;

    actions.push(
      buildBaseAction({
        clinicId: input.clinicId,
        clinicCode: input.clinicCode,
        dateKey: input.dateKey,
        actionType: "rebooking_opportunity",
        customerName: name,
        phoneMasked: maskPhone(row.customerPhone),
        memberId: row.memberId,
        customerKey: key,
        dedupeSuffix: key,
        title: "Rebook completed customer",
        summary: `${name} completed ${serviceName} and should be followed up for the next visit.`,
        reason: "Completed treatment customers are easiest to rebook within 24-48 hours.",
        recommendedAction: "Contact this customer within 24-48 hours and help them book the next visit.",
        evidence: [
          { label: "Last service date", value: input.dateKey },
          { label: "Service", value: serviceName },
          ...(row.therapistName ? [{ label: "Preferred therapist", value: row.therapistName }] : []),
          ...(moneyLabel(estimatedValue) ? [{ label: "Last payment amount", value: moneyLabel(estimatedValue)! }] : []),
        ],
        estimatedValue,
        estimatedValueLabel: "Potential rebooking value based on recent visit history",
        source: "daily_appointment_report",
        suggestedMessage: {
          language: "my-MM",
          text: "မင်္ဂလာပါ။ GreatTime မှ ဆက်သွယ်တာပါ။ သင့် treatment ပြီးသွားပြီဖြစ်လို့ နောက်တစ်ကြိမ် appointment ကို ဒီအပတ်ထဲမှာ စီစဉ်ပေးရမလားရှင်။",
        },
        score: {
          actionType: "rebooking_opportunity",
          customerImportance: "recent",
          confidence: row.paymentAmount != null ? "strong" : "moderate",
        },
      }),
    );
  }

  for (const row of input.packageFollowUps ?? []) {
    const name = cleanText(row.customerName, "Customer");
    const packageName = cleanText(row.packageName, "package");
    const key = customerKey({ customerName: name, memberId: row.memberId, phone: row.customerPhone });

    actions.push(
      buildBaseAction({
        clinicId: input.clinicId,
        clinicCode: input.clinicCode,
        dateKey: input.dateKey,
        actionType: "package_usage_follow_up",
        customerName: name,
        phoneMasked: maskPhone(row.customerPhone),
        memberId: row.memberId,
        customerKey: key,
        dedupeSuffix: `${key}|${packageName.toLowerCase()}`,
        title: "Follow up unused package balance",
        summary: `${name} has remaining sessions in ${packageName}.`,
        reason: "Unused package balance is a retention opportunity and should be scheduled before the customer goes inactive.",
        recommendedAction: "Contact the customer and help schedule remaining package sessions.",
        evidence: [
          { label: "Package", value: packageName },
          { label: "Purchased sessions", value: row.purchasedUnits ?? "Unknown" },
          { label: "Used sessions", value: row.usedUnits ?? "Unknown" },
          { label: "Remaining sessions", value: row.remainingUnits ?? "Unknown" },
          ...(row.lastVisitDate ? [{ label: "Last usage date", value: row.lastVisitDate }] : []),
          ...(row.daysSinceActivity != null ? [{ label: "Days since activity", value: row.daysSinceActivity }] : []),
        ],
        estimatedValueLabel: "Package retention opportunity",
        source: "package_portal",
        suggestedMessage: {
          language: "my-MM",
          text: "မင်္ဂလာပါ။ သင့် package session ကျန်ရှိနေပါသေးတယ်။ ဒီအပတ်ထဲမှာ appointment စီစဉ်ပေးရမလားရှင်။",
        },
        score: {
          actionType: "package_usage_follow_up",
          customerImportance: "repeat",
          confidence: row.remainingUnits != null ? "strong" : "moderate",
        },
      }),
    );
  }

  for (const row of input.packageUpsells ?? []) {
    const name = cleanText(row.customerName, "Customer");
    const key = customerKey({ customerName: name, memberId: row.memberId });
    const repeatedService = cleanText(row.repeatedService, "same service");
    const estimatedValue = row.averageInvoiceValue ?? null;

    actions.push(
      buildBaseAction({
        clinicId: input.clinicId,
        clinicCode: input.clinicCode,
        dateKey: input.dateKey,
        actionType: "package_upsell_opportunity",
        customerName: name,
        memberId: row.memberId,
        customerKey: key,
        dedupeSuffix: `${key}|${repeatedService.toLowerCase()}`,
        title: "Offer package to repeat service customer",
        summary: `${name} has repeated ${repeatedService} and may be ready for a package option.`,
        reason: "Repeat single-service customers are good candidates for package conversion.",
        recommendedAction: "Offer a suitable package based on the customer's repeated service usage.",
        evidence: [
          { label: "Recent visit count", value: row.recentVisitCount },
          ...(moneyLabel(row.recentSpend) ? [{ label: "Recent spend", value: moneyLabel(row.recentSpend)! }] : []),
          { label: "Repeated service/category", value: repeatedService },
          { label: "Active package found", value: "No active package evidence in payment rows" },
        ],
        estimatedValue,
        estimatedValueLabel: "Potential package sales opportunity",
        source: "payment_report",
        suggestedMessage: {
          language: "my-MM",
          text: "မင်္ဂလာပါ။ သင်မကြာခဏလာရောက်အသုံးပြုတဲ့ service အတွက် package option ရှိပါတယ်။ စိတ်ဝင်စားရင် အသေးစိတ်ရှင်းပြပေးပါမယ်ရှင်။",
        },
        score: {
          actionType: "package_upsell_opportunity",
          customerImportance: "repeat",
          confidence: "moderate",
        },
      }),
    );
  }

  for (const row of input.inactiveVipCustomers ?? []) {
    const name = cleanText(row.customerName, "Customer");
    const key = customerKey({ customerName: name, memberId: row.memberId });
    const estimatedValue = row.averageSpend ?? null;

    actions.push(
      buildBaseAction({
        clinicId: input.clinicId,
        clinicCode: input.clinicCode,
        dateKey: input.dateKey,
        actionType: "inactive_vip_follow_up",
        customerName: name,
        memberId: row.memberId,
        customerKey: key,
        dedupeSuffix: key,
        title: "Recover inactive VIP customer",
        summary: `${name} is a high-value customer who has not visited recently.`,
        reason: "Inactive VIP customers deserve personal follow-up before the relationship cools further.",
        recommendedAction: "Owner or senior sales staff should personally contact this customer.",
        evidence: [
          ...(moneyLabel(row.lifetimeSpend) ? [{ label: "Lifetime spend", value: moneyLabel(row.lifetimeSpend)! }] : []),
          { label: "Total visits", value: row.visitCount ?? "Unknown" },
          ...(row.lastVisitDate ? [{ label: "Last visit date", value: row.lastVisitDate }] : []),
          ...(row.daysSinceLastVisit != null ? [{ label: "Days since last visit", value: row.daysSinceLastVisit }] : []),
          ...(row.preferredService ? [{ label: "Preferred service", value: row.preferredService }] : []),
          ...(row.preferredTherapist ? [{ label: "Preferred therapist", value: row.preferredTherapist }] : []),
        ],
        estimatedValue,
        estimatedValueLabel: "High-value customer retention opportunity",
        source: "customer_portal",
        suggestedMessage: {
          language: "my-MM",
          text: "မင်္ဂလာပါ။ မကြာသေးခင်က မလာဖြစ်တာကြောင့် အဆင်ပြေတဲ့အချိန်မှာ appointment ပြန်စီစဉ်ပေးရမလားရှင်။ သင့်အတွက် သင့်လျော်တဲ့ service ကိုလည်း အကြံပြုပေးနိုင်ပါတယ်။",
        },
        score: {
          actionType: "inactive_vip_follow_up",
          customerImportance: "vip",
          confidence: row.lifetimeSpend != null ? "strong" : "moderate",
        },
      }),
    );
  }

  for (const row of input.paymentFollowUps ?? []) {
    const name = cleanText(row.customerName, "Customer");
    const key = customerKey({ customerName: name, memberId: row.memberId });

    actions.push(
      buildBaseAction({
        clinicId: input.clinicId,
        clinicCode: input.clinicCode,
        dateKey: input.dateKey,
        actionType: "payment_follow_up",
        customerName: name,
        memberId: row.memberId,
        customerKey: key,
        dedupeSuffix: row.invoiceNumber,
        title: "Follow up partial payment",
        summary: `${row.invoiceNumber} has ${moneyLabel(row.outstandingAmount) ?? "an outstanding balance"}.`,
        reason: "Outstanding or partial payments should be followed up before closing.",
        recommendedAction: "Owner, finance, or authorized admin should follow up.",
        evidence: [
          { label: "Invoice number", value: row.invoiceNumber },
          { label: "Outstanding amount", value: moneyLabel(row.outstandingAmount) ?? row.outstandingAmount },
          { label: "Payment status", value: cleanText(row.paymentStatus, "Unknown") },
          ...(row.lastPaymentDate ? [{ label: "Last payment date", value: row.lastPaymentDate }] : []),
        ],
        estimatedValue: row.outstandingAmount,
        source: "payment_report",
        suggestedMessage: {
          language: "my-MM",
          text: "မင်္ဂလာပါ။ GreatTime မှ ဆက်သွယ်တာပါ။ သင့် payment အခြေအနေကို confirm လုပ်ပေးချင်လို့ပါရှင်။ အချိန်ရရင် ပြန်ဆက်သွယ်ပေးပါနော်။",
        },
        score: {
          actionType: "payment_follow_up",
          customerImportance: "standard",
          confidence: row.outstandingAmount > 0 ? "strong" : "moderate",
        },
      }),
    );
  }

  return dedupeActions(actions)
    .sort((left, right) => right.priorityScore - left.priorityScore || left.title.localeCompare(right.title))
    .slice(0, DEFAULT_ACTION_LIMIT);
}

function dedupeActions(actions: GtGrowthAiSalesAction[]) {
  const byId = new Map<string, GtGrowthAiSalesAction>();
  actions.forEach((action) => {
    const current = byId.get(action.id);
    if (!current || action.priorityScore > current.priorityScore) {
      byId.set(action.id, action);
    }
  });
  return [...byId.values()];
}

function normalizeAction(id: string, data: Record<string, unknown> | undefined): GtGrowthAiSalesAction | null {
  if (!data || data.clinicId == null || data.dateKey == null || data.actionType == null) {
    return null;
  }

  const status = gtGrowthAiSalesActionStatuses.includes(data.status as GtGrowthAiSalesActionStatus)
    ? (data.status as GtGrowthAiSalesActionStatus)
    : "new";

  return {
    id,
    clinicId: String(data.clinicId),
    clinicCode: typeof data.clinicCode === "string" ? data.clinicCode : undefined,
    dateKey: String(data.dateKey),
    actionType: data.actionType as GtGrowthAiSalesActionType,
    priority: (data.priority as GtGrowthAiActionPriority) ?? "low",
    priorityScore: parseNumber(data.priorityScore),
    title: cleanText(typeof data.title === "string" ? data.title : undefined),
    summary: cleanText(typeof data.summary === "string" ? data.summary : undefined),
    reason: cleanText(typeof data.reason === "string" ? data.reason : undefined),
    recommendedAction: cleanText(typeof data.recommendedAction === "string" ? data.recommendedAction : undefined),
    customer: data.customer && typeof data.customer === "object" ? (data.customer as GtGrowthAiSalesAction["customer"]) : undefined,
    evidence: Array.isArray(data.evidence) ? (data.evidence as GtGrowthAiSalesActionEvidence[]) : [],
    suggestedMessage:
      data.suggestedMessage && typeof data.suggestedMessage === "object"
        ? (data.suggestedMessage as GtGrowthAiSalesAction["suggestedMessage"])
        : undefined,
    estimatedValue: data.estimatedValue == null ? undefined : parseNumber(data.estimatedValue),
    estimatedValueLabel: typeof data.estimatedValueLabel === "string" ? data.estimatedValueLabel : undefined,
    currency: data.currency === "MMK" ? "MMK" : undefined,
    source: (data.source as GtGrowthAiSalesAction["source"]) ?? "bigquery",
    assignedToTargetId: typeof data.assignedToTargetId === "string" ? data.assignedToTargetId : null,
    assignedToChatId: typeof data.assignedToChatId === "string" ? data.assignedToChatId : null,
    assignedToLabel: typeof data.assignedToLabel === "string" ? data.assignedToLabel : null,
    status,
    statusNote: typeof data.statusNote === "string" ? data.statusNote : null,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : nowIso(),
    assignedAt: typeof data.assignedAt === "string" ? data.assignedAt : null,
    lastStatusAt: typeof data.lastStatusAt === "string" ? data.lastStatusAt : null,
    lastStatusByTelegramUserId:
      typeof data.lastStatusByTelegramUserId === "string" ? data.lastStatusByTelegramUserId : null,
  };
}

export function summarizeSalesAssistantActions(actions: GtGrowthAiSalesAction[]): GtGrowthAiSalesAssistantSummary {
  const estimatedTotalValue = actions.reduce((total, action) => total + (action.estimatedValue ?? 0), 0);

  return {
    totalActions: actions.length,
    highPriorityCount: actions.filter((action) => action.priority === "high").length,
    rebookingCount: actions.filter((action) => action.actionType === "rebooking_opportunity").length,
    packageUsageCount: actions.filter((action) => action.actionType === "package_usage_follow_up").length,
    packageUpsellCount: actions.filter((action) => action.actionType === "package_upsell_opportunity").length,
    inactiveVipCount: actions.filter((action) => action.actionType === "inactive_vip_follow_up").length,
    paymentFollowUpCount: actions.filter((action) => action.actionType === "payment_follow_up").length,
    ...(estimatedTotalValue > 0
      ? {
          estimatedTotalValue,
          currency: "MMK" as const,
        }
      : {
          estimatedTotalValueLabel: "Opportunity value available after source reports include reliable amounts",
        }),
  };
}

export function summarizeSalesAssistantProgress(actions: GtGrowthAiSalesAction[]): GtGrowthAiSalesAssistantProgress {
  const handledStatuses = new Set<GtGrowthAiSalesActionStatus>(["contacted", "replied", "booked", "purchased", "closed"]);
  const estimatedOpportunityHandled = actions
    .filter((action) => handledStatuses.has(action.status))
    .reduce((total, action) => total + (action.estimatedValue ?? 0), 0);

  return {
    assigned: actions.filter((action) => action.status === "assigned").length,
    contacted: actions.filter((action) => action.status === "contacted").length,
    replied: actions.filter((action) => action.status === "replied").length,
    booked: actions.filter((action) => action.status === "booked").length,
    purchased: actions.filter((action) => action.status === "purchased").length,
    skipped: actions.filter((action) => action.status === "skipped").length,
    closed: actions.filter((action) => action.status === "closed").length,
    pending: actions.filter((action) => action.status === "new" || action.status === "assigned").length,
    ...(estimatedOpportunityHandled > 0
      ? {
          estimatedOpportunityHandled,
          currency: "MMK" as const,
        }
      : {
          estimatedOpportunityHandledLabel: "No handled opportunity value yet",
        }),
  };
}

export async function listSalesAssistantActions(input: {
  clinicId: string;
  dateKey: string;
  status?: GtGrowthAiSalesActionStatus;
  actionType?: GtGrowthAiSalesActionType;
  priority?: GtGrowthAiActionPriority;
}) {
  const snapshot = await actionCollection()
    .where("clinicId", "==", input.clinicId)
    .where("dateKey", "==", input.dateKey)
    .get();

  return snapshot.docs
    .map((doc) => normalizeAction(doc.id, doc.data()))
    .filter((action): action is GtGrowthAiSalesAction => Boolean(action))
    .filter((action) => !input.status || action.status === input.status)
    .filter((action) => !input.actionType || action.actionType === input.actionType)
    .filter((action) => !input.priority || action.priority === input.priority)
    .sort((left, right) => right.priorityScore - left.priorityScore || left.title.localeCompare(right.title));
}

async function upsertActions(actions: GtGrowthAiSalesAction[], forceRefresh = false) {
  const saved: GtGrowthAiSalesAction[] = [];

  for (const action of actions) {
    const ref = actionCollection().doc(action.id);
    const snapshot = await ref.get();
    const existing = normalizeAction(snapshot.id, snapshot.data());
    const timestamp = nowIso();
    const nextAction: GtGrowthAiSalesAction =
      existing && !forceRefresh
        ? {
            ...action,
            status: existing.status,
            statusNote: existing.statusNote,
            assignedToTargetId: existing.assignedToTargetId,
            assignedToChatId: existing.assignedToChatId,
            assignedToLabel: existing.assignedToLabel,
            assignedAt: existing.assignedAt,
            lastStatusAt: existing.lastStatusAt,
            lastStatusByTelegramUserId: existing.lastStatusByTelegramUserId,
            createdAt: existing.createdAt,
            updatedAt: timestamp,
          }
        : {
            ...action,
            updatedAt: timestamp,
          };

    await ref.set(nextAction, { merge: true });
    saved.push(nextAction);
  }

  return saved.sort((left, right) => right.priorityScore - left.priorityScore || left.title.localeCompare(right.title));
}

function completedAppointmentFacts(rows: ApicoreBookingDetailsRow[], paymentsByCustomer: Map<string, number>) {
  return rows
    .filter((row) => COMPLETED_STATUSES.has(cleanText(row.status).toUpperCase()))
    .map((row) => {
      const key = customerKey({
        customerName: row.MemberName,
        phone: row.MemberPhoneNumber,
      });
      return {
        customerName: cleanText(row.MemberName, "Customer"),
        customerPhone: row.MemberPhoneNumber,
        serviceName: cleanText(row.ServiceName, "recent treatment"),
        therapistName: cleanText(row.PractitionerName, "Unassigned"),
        paymentAmount: paymentsByCustomer.get(key) ?? null,
      };
    })
    .slice(0, 12);
}

async function collectSourceFacts(input: {
  clinicId: string;
  clinicCode: string;
  dateKey: string;
  authorizationHeader?: string;
}) {
  const recentFromDate = addDays(input.dateKey, -90);
  const packageFromDate = addDays(input.dateKey, -180);
  const vipFromDate = addDays(input.dateKey, -365);
  const facts: BuildActionFactsInput = {
    clinicId: input.clinicId,
    clinicCode: input.clinicCode,
    dateKey: input.dateKey,
    completedAppointments: [],
    packageFollowUps: [],
    packageUpsells: [],
    inactiveVipCustomers: [],
    paymentFollowUps: [],
  };

  const [appointmentsResult, dayPaymentReport, recentPaymentReport, packageReport, vipReport] = await Promise.allSettled([
    getTodayAppointmentsForClinic({
      clinicCode: input.clinicCode,
      dateKey: input.dateKey,
      authorizationHeader: input.authorizationHeader,
    }),
    getPaymentReport({
      clinicId: input.clinicId,
      clinicCode: input.clinicCode,
      fromDate: input.dateKey,
      toDate: input.dateKey,
      search: "",
      paymentMethod: "",
      includeZeroValues: true,
      limit: 300,
      offset: 0,
    }),
    getPaymentReport({
      clinicId: input.clinicId,
      clinicCode: input.clinicCode,
      fromDate: recentFromDate,
      toDate: input.dateKey,
      search: "",
      paymentMethod: "",
      includeZeroValues: false,
      limit: 500,
      offset: 0,
    }),
    getPackagePortalReport({
      clinicId: input.clinicId,
      fromDate: packageFromDate,
      toDate: input.dateKey,
      packageId: "",
      category: "",
      therapist: "",
      salesperson: "",
      status: "",
      inactivityBucket: "",
      onlyRemaining: true,
      authorizationHeader: input.authorizationHeader,
    }),
    getCustomerPortalList({
      clinicCode: input.clinicCode,
      fromDate: vipFromDate,
      toDate: input.dateKey,
      search: "",
      status: "",
      spendTier: "VIP",
      therapist: "",
      serviceCategory: "",
      sortBy: "lifetimeSpend",
      sortDirection: "desc",
      limit: 50,
      offset: 0,
    }),
  ]);

  const dayPayments = dayPaymentReport.status === "fulfilled" ? dayPaymentReport.value : null;
  const paymentByCustomer = new Map<string, number>();
  (dayPayments?.rows ?? []).forEach((row) => {
    const key = customerKey({ customerName: row.customerName, memberId: row.memberId });
    paymentByCustomer.set(key, Math.max(paymentByCustomer.get(key) ?? 0, row.invoiceNetTotal ?? 0));
  });

  if (appointmentsResult.status === "fulfilled") {
    facts.completedAppointments = completedAppointmentFacts(appointmentsResult.value.rows, paymentByCustomer);
  }

  if (packageReport.status === "fulfilled") {
    facts.packageFollowUps = packageReport.value.followUpRows
      .filter((row) => row.remainingUnits > 0 && (row.needsFollowUp || row.daysSinceActivity >= 21))
      .slice(0, 12)
      .map((row) => ({
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        memberId: row.memberId,
        packageName: row.packageName,
        purchasedUnits: row.purchasedUnits,
        usedUnits: row.usedUnits,
        remainingUnits: row.remainingUnits,
        lastVisitDate: row.lastVisitDate,
        daysSinceActivity: row.daysSinceActivity,
        therapist: row.therapist,
      }));
  }

  if (recentPaymentReport.status === "fulfilled") {
    const grouped = new Map<
      string,
      {
        customerName: string;
        memberId: string;
        invoiceNumbers: Set<string>;
        services: Map<string, number>;
        spend: number;
      }
    >();
    for (const row of recentPaymentReport.value.rows) {
      if (row.servicePackageName) {
        continue;
      }
      const key = customerKey({ customerName: row.customerName, memberId: row.memberId });
      const current =
        grouped.get(key) ??
        {
          customerName: row.customerName,
          memberId: row.memberId,
          invoiceNumbers: new Set<string>(),
          services: new Map<string, number>(),
          spend: 0,
        };
      current.invoiceNumbers.add(row.invoiceNumber);
      current.spend += row.invoiceNetTotal ?? 0;
      const service = cleanText(row.serviceName, "Service");
      current.services.set(service, (current.services.get(service) ?? 0) + 1);
      grouped.set(key, current);
    }

    facts.packageUpsells = [...grouped.values()]
      .filter((row) => row.invoiceNumbers.size >= 2)
      .map((row) => {
        const repeatedService = [...row.services.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "Service";
        return {
          customerName: row.customerName,
          memberId: row.memberId,
          recentVisitCount: row.invoiceNumbers.size,
          recentSpend: row.spend,
          repeatedService,
          averageInvoiceValue: row.invoiceNumbers.size > 0 ? row.spend / row.invoiceNumbers.size : null,
        };
      })
      .sort((left, right) => (right.recentSpend ?? 0) - (left.recentSpend ?? 0))
      .slice(0, 10);
  }

  if (vipReport.status === "fulfilled") {
    facts.inactiveVipCustomers = vipReport.value.rows
      .filter((row) => (row.daysSinceLastVisit ?? 0) >= 45)
      .slice(0, 10)
      .map((row) => ({
        customerName: row.customerName,
        memberId: row.memberId,
        lifetimeSpend: row.lifetimeSpend,
        averageSpend: row.averageSpend,
        visitCount: row.visitCount,
        lastVisitDate: row.lastVisitDate,
        daysSinceLastVisit: row.daysSinceLastVisit,
        preferredService: row.lastService,
        preferredTherapist: row.primaryTherapist,
      }));
  }

  facts.paymentFollowUps = (dayPayments?.rows ?? [])
    .filter((row) => (row.orderBalance ?? 0) > 0 || (row.orderCreditBalance ?? 0) > 0)
    .map((row) => ({
      customerName: row.customerName,
      memberId: row.memberId,
      invoiceNumber: row.invoiceNumber,
      outstandingAmount: Math.max(row.orderBalance ?? 0, row.orderCreditBalance ?? 0),
      paymentStatus: row.paymentStatus,
      lastPaymentDate: row.dateLabel,
    }))
    .slice(0, 10);

  return facts;
}

export async function generateSalesAssistantActions(input: {
  clinicId: string;
  clinicCode: string;
  dateKey: string;
  forceRefresh?: boolean;
  authorizationHeader?: string;
}) {
  const facts = await collectSourceFacts(input);
  const actions = buildSalesAssistantActionsFromFacts(facts);
  return upsertActions(actions, input.forceRefresh);
}

export function buildLockedSalesAssistantResponse(premium: GtGrowthAiSalesAssistantResponse["premium"]) {
  return {
    premium,
    lockedPreview: {
      title: "Unlock GT Growth AI Sales Assistant",
      message:
        "GreatTime AI finds customers to rebook, package customers to follow up, VIP customers to recover, and payments to follow up.",
      teaserBullets: [
        "Daily sales task list for your team lead",
        "Suggested Myanmar customer messages",
        "Follow-up status tracking and owner progress summary",
      ],
    },
  } satisfies GtGrowthAiSalesAssistantResponse;
}

export async function getSalesAssistantActionsResponse(input: {
  clinicId: string;
  dateKey: string;
  status?: GtGrowthAiSalesActionStatus;
  actionType?: GtGrowthAiSalesActionType;
  priority?: GtGrowthAiActionPriority;
}) {
  const premium = await hasFeatureAccess({
    clinicId: input.clinicId,
    feature: GT_GROWTH_AI_FEATURE_GATE,
    teaser: {
      insightCount: 1,
      opportunityCount: 1,
      estimatedOpportunityLabel: "Daily customer follow-up opportunities",
    },
  });

  if (!premium.enabled) {
    return buildLockedSalesAssistantResponse(premium);
  }

  const actions = await listSalesAssistantActions(input);
  return {
    premium,
    summary: summarizeSalesAssistantActions(actions),
    actions,
  } satisfies GtGrowthAiSalesAssistantResponse;
}

export async function requireSalesAssistantPremium(clinicId: string) {
  const premium = await hasFeatureAccess({
    clinicId,
    feature: GT_GROWTH_AI_FEATURE_GATE,
  });

  if (!premium.enabled) {
    const error = new Error(premium.lockedReason || "gt_growth_ai is not enabled for this clinic.");
    error.name = "GtGrowthAiLocked";
    throw error;
  }

  return premium;
}

export async function updateSalesAssistantActionStatus(input: {
  clinicId: string;
  actionId: string;
  status: GtGrowthAiSalesActionUpdateStatus;
  note?: string | null;
  updatedByTelegramUserId?: string | null;
}) {
  const ref = actionCollection().doc(input.actionId);
  const snapshot = await ref.get();
  const action = normalizeAction(snapshot.id, snapshot.data());

  if (!action || action.clinicId !== input.clinicId) {
    throw new Error("Sales assistant action was not found for this clinic.");
  }

  const timestamp = nowIso();
  const nextAction: GtGrowthAiSalesAction = {
    ...action,
    status: input.status,
    statusNote: input.note?.trim() || action.statusNote || null,
    updatedAt: timestamp,
    lastStatusAt: timestamp,
    lastStatusByTelegramUserId: input.updatedByTelegramUserId ?? action.lastStatusByTelegramUserId ?? null,
  };

  await ref.set(nextAction, { merge: true });
  return nextAction;
}

export async function markSalesAssistantActionsAssigned(input: {
  clinicId: string;
  actions: GtGrowthAiSalesAction[];
  target: TelegramTargetStatus;
}) {
  const timestamp = nowIso();
  const assigned: GtGrowthAiSalesAction[] = [];

  for (const action of input.actions) {
    if (action.clinicId !== input.clinicId) {
      continue;
    }

    const nextAction: GtGrowthAiSalesAction = {
      ...action,
      status: action.status === "new" ? "assigned" : action.status,
      assignedToTargetId: targetId(input.target),
      assignedToChatId: input.target.telegramChatId,
      assignedToLabel: input.target.targetLabel,
      assignedAt: action.assignedAt ?? timestamp,
      updatedAt: timestamp,
    };

    await actionCollection().doc(action.id).set(nextAction, { merge: true });
    assigned.push(nextAction);
  }

  return assigned;
}

export async function getSalesAssistantProgress(input: { clinicId: string; dateKey: string }) {
  const actions = await listSalesAssistantActions(input);
  return {
    summary: summarizeSalesAssistantActions(actions),
    progress: summarizeSalesAssistantProgress(actions),
  };
}

function targetId(target: TelegramTargetStatus) {
  return `${encodeURIComponent(target.clinicId)}__${encodeURIComponent(target.telegramChatId ?? "")}`;
}

function targetMatchesPurpose(target: TelegramTargetStatus, purpose: GtGrowthAiTelegramTargetPurpose) {
  return target.targetPurpose === purpose;
}

function pickTarget(targets: TelegramTargetStatus[], purpose: GtGrowthAiTelegramTargetPurpose) {
  const exact = targets.find((target) => target.telegramChatId && targetMatchesPurpose(target, purpose));
  if (exact) {
    return exact;
  }

  if (purpose === "sales_lead") {
    return targets.find((target) => target.telegramChatId && target.telegramChatType === "private") ?? null;
  }

  if (purpose === "owner_group") {
    return (
      targets.find((target) => target.telegramChatId && target.targetPurpose === "manager") ??
      targets.find((target) => target.telegramChatId && target.telegramChatType !== "private") ??
      null
    );
  }

  return null;
}

function actionTypeLabel(type: GtGrowthAiSalesActionType) {
  switch (type) {
    case "rebooking_opportunity":
      return "Rebooking";
    case "package_usage_follow_up":
      return "Package follow-up";
    case "package_upsell_opportunity":
      return "Package upsell";
    case "inactive_vip_follow_up":
      return "VIP follow-up";
    default:
      return "Payment follow-up";
  }
}

function shortCustomerLabel(action: GtGrowthAiSalesAction, includeCustomerDetails: boolean) {
  if (!includeCustomerDetails) {
    return "Customer";
  }

  return action.customer?.customerName || action.customer?.phoneMasked || "Customer";
}

export function formatSalesAssistantTaskMessage(input: {
  actions: GtGrowthAiSalesAction[];
  summary: GtGrowthAiSalesAssistantSummary;
  includeCustomerDetails: boolean;
}) {
  const lines = [
    "GT Growth AI — Today's Sales Tasks",
    "",
    `Today I found ${input.summary.totalActions.toLocaleString("en-US")} revenue opportunities.`,
  ];

  if (input.summary.estimatedTotalValue != null) {
    lines.push(`Estimated opportunity: ${moneyLabel(input.summary.estimatedTotalValue)}.`);
  } else if (input.summary.estimatedTotalValueLabel) {
    lines.push(`Estimated opportunity: ${input.summary.estimatedTotalValueLabel}.`);
  }

  lines.push("");
  input.actions.slice(0, TELEGRAM_TASK_LIMIT).forEach((action, index) => {
    const number = index + 1;
    lines.push(`${number}. ${shortCustomerLabel(action, input.includeCustomerDetails)}`);
    lines.push(`Reason: ${action.reason}`);
    lines.push(`Action: ${action.recommendedAction}`);
    if (action.estimatedValue != null) {
      lines.push(`Value: ${moneyLabel(action.estimatedValue)}`);
    }
    lines.push("");
  });

  lines.push("Reply:");
  lines.push("C1 = contacted, B1 = booked, P1 = purchased, S1 = skipped");
  lines.push("M1 = show suggested message");
  lines.push("/tasks = show today's tasks");

  return lines.join("\n").trim();
}

export function formatSalesAssistantOwnerSummary(input: {
  summary: GtGrowthAiSalesAssistantSummary;
  targetLabel?: string | null;
}) {
  return [
    `GT Growth AI assigned ${input.summary.totalActions.toLocaleString("en-US")} sales follow-up tasks to ${input.targetLabel || "Sales Lead"}.`,
    "",
    "Today's focus:",
    `- Rebooking: ${input.summary.rebookingCount}`,
    `- Package follow-up: ${input.summary.packageUsageCount}`,
    `- Package upsell: ${input.summary.packageUpsellCount}`,
    `- VIP follow-up: ${input.summary.inactiveVipCount}`,
    `- Payment follow-up: ${input.summary.paymentFollowUpCount}`,
    "",
    "I will send progress summary later.",
  ].join("\n");
}

export function formatSalesAssistantProgressMessage(progress: GtGrowthAiSalesAssistantProgress) {
  return [
    "GT Growth AI — Follow-up Progress",
    "",
    `Assigned: ${progress.assigned}`,
    `Contacted: ${progress.contacted}`,
    `Replied: ${progress.replied}`,
    `Booked: ${progress.booked}`,
    `Purchased: ${progress.purchased}`,
    `Skipped: ${progress.skipped}`,
    `Pending: ${progress.pending}`,
    "",
    `Estimated opportunity handled: ${
      progress.estimatedOpportunityHandled != null
        ? moneyLabel(progress.estimatedOpportunityHandled)
        : progress.estimatedOpportunityHandledLabel
    }`,
  ].join("\n");
}

export async function createTelegramTaskSession(input: {
  clinicId: string;
  chatId: string;
  dateKey: string;
  actions: GtGrowthAiSalesAction[];
}) {
  const indexToActionId: Record<string, string> = {};
  input.actions.slice(0, TELEGRAM_TASK_LIMIT).forEach((action, index) => {
    indexToActionId[String(index + 1)] = action.id;
  });
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + TASK_SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const id = `${encodeURIComponent(input.clinicId)}__${encodeURIComponent(input.chatId)}__${input.dateKey}`;

  await taskSessionCollection().doc(id).set(
    {
      clinicId: input.clinicId,
      chatId: input.chatId,
      dateKey: input.dateKey,
      indexToActionId,
      createdAt,
      expiresAt,
    },
    { merge: true },
  );

  return { id, indexToActionId };
}

async function readTelegramTaskSession(input: { clinicId: string; chatId: string; dateKey: string }) {
  const id = `${encodeURIComponent(input.clinicId)}__${encodeURIComponent(input.chatId)}__${input.dateKey}`;
  const snapshot = await taskSessionCollection().doc(id).get();
  const data = snapshot.data() as
    | {
        indexToActionId?: Record<string, string>;
        expiresAt?: string;
      }
    | undefined;

  if (!data?.indexToActionId || (data.expiresAt && new Date(data.expiresAt).getTime() <= Date.now())) {
    return null;
  }

  return data.indexToActionId;
}

export async function buildSalesAssistantSendPlan(input: {
  clinicId: string;
  clinicCode: string;
  clinicName?: string;
  dateKey: string;
  targetPurpose?: GtGrowthAiTelegramTargetPurpose;
  authorizationHeader?: string;
}) {
  let actions = await listSalesAssistantActions({ clinicId: input.clinicId, dateKey: input.dateKey });
  if (actions.length === 0) {
    actions = await generateSalesAssistantActions({
      clinicId: input.clinicId,
      clinicCode: input.clinicCode,
      dateKey: input.dateKey,
      authorizationHeader: input.authorizationHeader,
    });
  }

  const status = await getTelegramIntegrationStatus({
    clinicId: input.clinicId,
    clinicCode: input.clinicCode,
    clinicName: input.clinicName,
  });
  const salesTarget = pickTarget(status.linkedTargets, input.targetPurpose ?? "sales_lead");
  const ownerTarget = pickTarget(status.linkedTargets, "owner_group");
  const summary = summarizeSalesAssistantActions(actions);
  const includeCustomerDetails = salesTarget?.telegramChatType === "private";

  return {
    dateKey: input.dateKey,
    actions,
    summary,
    salesTarget,
    ownerTarget,
    salesMessage: salesTarget?.telegramChatId
      ? includeCustomerDetails
        ? formatSalesAssistantTaskMessage({
            actions,
            summary,
            includeCustomerDetails,
          })
        : formatSalesAssistantOwnerSummary({
            summary,
            targetLabel: salesTarget.targetLabel,
          })
      : null,
    ownerMessage: ownerTarget?.telegramChatId
      ? formatSalesAssistantOwnerSummary({
          summary,
          targetLabel: salesTarget?.targetLabel,
        })
      : null,
  } satisfies SendPlan;
}

type ParsedStatusCommand = {
  status: GtGrowthAiSalesActionUpdateStatus | "message";
  index: string;
};

function parseStatusCommand(text: string): ParsedStatusCommand | null {
  const trimmed = text.trim();
  const compact = trimmed.match(/^([CBPSM])\s*(\d{1,2})$/i);
  if (compact) {
    const code = compact[1].toUpperCase();
    const index = compact[2];
    const statusByCode: Record<string, GtGrowthAiSalesActionUpdateStatus | "message"> = {
      C: "contacted",
      B: "booked",
      P: "purchased",
      S: "skipped",
      M: "message",
    };
    return { status: statusByCode[code], index };
  }

  const slash = trimmed.match(/^\/(contacted|booked|purchased|skipped|message)(?:@\w+)?\s+(\d{1,2})$/i);
  if (!slash) {
    return null;
  }

  return {
    status: slash[1].toLowerCase() === "message" ? "message" : (slash[1].toLowerCase() as GtGrowthAiSalesActionUpdateStatus),
    index: slash[2],
  };
}

export async function buildTelegramSalesAssistantReply(input: {
  chatId: string;
  text: string;
  telegramUserId?: string | null;
}) {
  const { getTelegramTargetByChatId } = await import("../telegram/storage.service.js");
  const target = await getTelegramTargetByChatId(input.chatId);

  if (!target) {
    return "This chat is not linked yet. Please generate a Telegram link code in GreatTime settings and send it here.";
  }

  const premium = await hasFeatureAccess({
    clinicId: target.clinicId,
    feature: GT_GROWTH_AI_FEATURE_GATE,
  });

  if (!premium.enabled) {
    return "Unlock GT Growth AI Sales Assistant to receive customer follow-up tasks and progress tracking.";
  }

  const dateKey = normalizeDateKey(null, target.timezone);
  const trimmed = input.text.trim();

  if (/^\/tasks(?:@\w+)?$/i.test(trimmed) || /^\/today(?:@\w+)?$/i.test(trimmed)) {
    let actions = await listSalesAssistantActions({ clinicId: target.clinicId, dateKey });
    if (actions.length === 0) {
      actions = await generateSalesAssistantActions({
        clinicId: target.clinicId,
        clinicCode: target.clinicCode,
        dateKey,
      });
    }
    if (target.telegramChatType !== "private") {
      return formatSalesAssistantOwnerSummary({
        summary: summarizeSalesAssistantActions(actions),
        targetLabel: target.targetLabel,
      });
    }
    await createTelegramTaskSession({
      clinicId: target.clinicId,
      chatId: input.chatId,
      dateKey,
      actions,
    });
    return formatSalesAssistantTaskMessage({
      actions,
      summary: summarizeSalesAssistantActions(actions),
      includeCustomerDetails: target.telegramChatType === "private",
    });
  }

  const command = parseStatusCommand(trimmed);
  if (!command) {
    return null;
  }

  const session = await readTelegramTaskSession({
    clinicId: target.clinicId,
    chatId: input.chatId,
    dateKey,
  });

  if (!session) {
    return "No active task list found. Send /tasks first.";
  }

  const actionId = session[command.index];
  if (!actionId) {
    return `Task ${command.index} was not found in the latest task list. Send /tasks to refresh.`;
  }

  const actionSnapshot = await actionCollection().doc(actionId).get();
  const action = normalizeAction(actionSnapshot.id, actionSnapshot.data());
  if (!action || action.clinicId !== target.clinicId) {
    return "That task is no longer available for this clinic.";
  }

  if (command.status === "message") {
    return action.suggestedMessage?.text || "No suggested message is available for this task.";
  }

  const updated = await updateSalesAssistantActionStatus({
    clinicId: target.clinicId,
    actionId,
    status: command.status,
    updatedByTelegramUserId: input.telegramUserId ?? null,
  });

  return `Updated task ${command.index}: ${actionTypeLabel(updated.actionType)} marked ${updated.status}.`;
}

export { normalizeDateKey as normalizeSalesAssistantDateKey };
