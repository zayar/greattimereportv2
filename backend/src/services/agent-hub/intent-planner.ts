import { env } from "../../config/env.js";
import { shiftRange, toIsoDate } from "../../utils/date-range.js";
import { formatDateKeyInTimeZone, normalizeTimeZone } from "../telegram/time.js";
import { hasCustomerEntityReference, hasExplicitCustomerSearchIntent, isCustomer360Question } from "./customer-query.js";
import { buildReadOnlyRefusalMessage, isDangerousBusinessMutationRequest } from "./read-only-guard.js";
import { isService360Question } from "./service-query.js";
import { isAppointmentLedgerQuestion, resolveAgent } from "./supervisor.js";
import type {
  AgentPeriod,
  GreatTimeAgentChatRequest,
  GreatTimeAgentId,
  GreatTimeAgentIntentPlan,
} from "./types.js";

export { isDangerousBusinessMutationRequest } from "./read-only-guard.js";
export const isBusinessSourceMutationRequest = isDangerousBusinessMutationRequest;

function isUnsupportedWriteRequest(message: string) {
  return isDangerousBusinessMutationRequest(message);
}

function dateFromUtc(date: Date) {
  return toIsoDate(date);
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateFromUtc(date);
}

function startOfWeek(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return dateFromUtc(date);
}

function startOfMonth(dateKey: string) {
  return `${dateKey.slice(0, 8)}01`;
}

function daysInUtcMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function buildPeriod(fromDate: string, toDate: string, label: string): AgentPeriod {
  const previous = shiftRange(fromDate, toDate);
  return {
    fromDate,
    toDate,
    label,
    ...previous,
  };
}

function buildThisMonthPeriod(today: string): AgentPeriod {
  const current = new Date(`${today}T00:00:00.000Z`);
  const currentYear = current.getUTCFullYear();
  const currentMonth = current.getUTCMonth();
  const previousMonth = currentMonth === 0 ? 11 : currentMonth - 1;
  const previousYear = currentMonth === 0 ? currentYear - 1 : currentYear;
  const previousDay = Math.min(current.getUTCDate(), daysInUtcMonth(previousYear, previousMonth));

  return {
    fromDate: startOfMonth(today),
    toDate: today,
    label: "this month",
    previousFromDate: dateFromUtc(new Date(Date.UTC(previousYear, previousMonth, 1))),
    previousToDate: dateFromUtc(new Date(Date.UTC(previousYear, previousMonth, previousDay))),
  };
}

export function extractAgentPeriod(params: {
  message: string;
  fromDate?: string;
  toDate?: string;
  timezone?: string;
  now?: Date;
}): AgentPeriod {
  const normalized = params.message.toLowerCase();
  const timeZone = normalizeTimeZone(params.timezone || env.DEFAULT_TIMEZONE);
  const today = formatDateKeyInTimeZone(params.now ?? new Date(), timeZone);

  if (/last\s+365\s+days|365\s+days|ရက်\s*365/i.test(params.message)) {
    return buildPeriod(addDays(today, -364), today, "last 365 days");
  }

  if (/last\s+90\s+days|90\s+days|ရက်\s*90/i.test(params.message)) {
    return buildPeriod(addDays(today, -89), today, "last 90 days");
  }

  if (/last\s+30\s+days|30\s+days|ရက်\s*30/i.test(params.message)) {
    return buildPeriod(addDays(today, -29), today, "last 30 days");
  }

  if (/this\s+week|current\s+week|ဒီ\s*အပတ်/i.test(params.message)) {
    return buildPeriod(startOfWeek(today), today, "this week");
  }

  if (/last\s+week|previous\s+week|ပြီးခဲ့တဲ့\s*အပတ်/i.test(params.message)) {
    const thisWeekStart = startOfWeek(today);
    const previousTo = addDays(thisWeekStart, -1);
    const previousFrom = addDays(previousTo, -6);
    return buildPeriod(previousFrom, previousTo, "last week");
  }

  if (/yesterday|မနေ့/i.test(normalized)) {
    const yesterday = addDays(today, -1);
    return buildPeriod(yesterday, yesterday, "yesterday");
  }

  if (/today|now|right now|ဒီနေ့|ယခု|အခု/i.test(params.message)) {
    return buildPeriod(today, today, "today");
  }

  if (/this\s+month|current\s+month|month\s+to\s+date|mtd|ဒီ\s*လ/i.test(params.message)) {
    return buildThisMonthPeriod(today);
  }

  if (/this\s+year|current\s+year|year\s+to\s+date|ytd|ဒီ\s*နှစ်/i.test(params.message)) {
    return buildPeriod(`${today.slice(0, 4)}-01-01`, today, "year to date");
  }

  if (params.fromDate && params.toDate) {
    return buildPeriod(params.fromDate, params.toDate, `${params.fromDate} to ${params.toDate}`);
  }

  return buildThisMonthPeriod(today);
}

function hasExplicitPeriodCue(message: string) {
  return /last\s+\d+\s+days|last\s+365\s+days|365\s+days|last\s+90\s+days|90\s+days|last\s+30\s+days|30\s+days|this\s+week|current\s+week|last\s+week|previous\s+week|yesterday|today|now|right now|this\s+month|current\s+month|month\s+to\s+date|mtd|this\s+year|current\s+year|year\s+to\s+date|ytd|ဒီနေ့|ဒီ\s*လ|ဒီ\s*နှစ်|မနေ့/i.test(
    message,
  );
}

function detectFinanceIntent(message: string) {
  if (/compare|versus|vs|last week|previous|ယှဉ်/i.test(message)) {
    return "sales_period_comparison";
  }
  if (/payment method|method|by payment|cash|bank|kpay|kbz|နည်းလမ်း/i.test(message)) {
    return "payment_method_breakdown";
  }
  if (/payment|collection|collected|ငွေ/i.test(message)) {
    return "payment_summary";
  }
  if (/invoice|detail|voucher|ဘောက်ချာ/i.test(message)) {
    return "invoice_detail";
  }
  if (/purchase history|bought|ဝယ်/i.test(message)) {
    return "customer_purchase_history";
  }
  return "sales_summary";
}

function detectCustomerIntent(message: string) {
  if (/returned after|came back after|reactivated|ပြန်လာ.*follow|follow.*ပြန်လာ/i.test(message)) {
    return "reactivated_customer";
  }
  if (/dormant package|active balance.*90|sessions?.*90|package sessions?.*not visited|လက်ကျန်.*90|package.*မလာတာ/i.test(message)) {
    return "dormant_with_active_balance_90d";
  }
  if (/lapsed|inactive.*90|90\s+days.*no visit|မလာတာ.*90|90.*မလာ/i.test(message)) {
    return "lapsed_customer_90d";
  }
  if (/(?:bought|purchase|purchased|package|service|ဝယ်)[\s\S]{0,80}(?:not started|never checked in|never visited|မစ|မလာသေး|မလာ)|(?:not started|never checked in|never visited|မစ|မလာသေး|မလာ)[\s\S]{0,80}(?:bought|purchase|purchased|package|service|ဝယ်)/i.test(message)) {
    return "unactivated_purchase";
  }
  if (/(?:bought|purchase|purchased|package|ဝယ်)[\s\S]{0,80}(?:never came|never visit|never visited|မလာသေး|မလာ)|(?:never came|never visit|never visited|မလာသေး|မလာ)[\s\S]{0,80}(?:bought|purchase|purchased|package|ဝယ်)/i.test(message)) {
    return "package_bought_never_came";
  }
  if (/(not used|unused package|package.*not use|မသုံး|အသုံးမပြု)/i.test(message)) {
    return "package_bought_not_used";
  }
  if (
    (hasExplicitCustomerSearchIntent(message) || hasCustomerEntityReference(message)) &&
    /purchase history|purchase|purchased|bought|buy|payment|package|ဝယ်/i.test(message)
  ) {
    return "customer_purchase_history";
  }
  if (isCustomer360Question(message)) {
    return "customer_360";
  }
  if (/unused|balance|remaining|လက်ကျန်|ကျန်/i.test(message)) {
    return "unused_package_balance";
  }
  if (/churn|risk|inactive|ဆုံးရှုံး|အန္တရာယ်/i.test(message)) {
    return "churn_risk";
  }
  if (/due|overdue|ပြန်လာ|ကုသမှု/i.test(message)) {
    return "treatment_due";
  }
  if (
    /follow[- ]?up|priority|priorities|need attention|owner[- ]?safe|call|contact|message|rebook|return visit|ဆက်သွယ်|ပြန်ချိန်း/i.test(
      message,
    )
  ) {
    return "follow_up_today";
  }
  if (/top customers?|best customers?|vip customers?|highest.*customers?|most valuable|valuable customers?|top spend|top visit|အကောင်းဆုံး|အများဆုံး/i.test(message)) {
    return "top_customers";
  }
  if (/history|last treatment|practitioner|package|purchase|payment/i.test(message)) {
    return "customer_overview";
  }
  return "customer_search";
}

const OWNER_DAILY_BRIEF_PATTERN =
  /daily\s+brief|daily\s+summary|morning\s+brief|owner\s+brief|business\s+brief|what\s+should\s+(?:i|we)\s+focus(?:\s+on)?\s+today|what\s+needs\s+attention|needs?\s+attention|focus\s+today|risks?\s+today|what\s+are\s+the\s+risks\s+today|opportunities\s+today|what\s+are\s+the\s+opportunities\s+today|what\s+should\s+we\s+do\s+next|what\s+to\s+do\s+next|next\s+actions?|what\s+should\s+the\s+owner\s+know|ဒီနေ့\s*ဘာလုပ်ရမလဲ|ဘာကို\s*focus\s*လုပ်ရမလဲ|ဒီနေ့\s*အရေးကြီးတာ|ဒီနေ့.*(?:အာရုံစိုက်|သတိထား)|မနက်.*brief/i;

export function isOwnerDailyBriefIntentMessage(message: string) {
  return OWNER_DAILY_BRIEF_PATTERN.test(message);
}

export function toolsForBusinessOwnerDailyBrief(enabled = env.AGENT_OWNER_DAILY_BRIEF_ENABLED) {
  return enabled ? ["get_owner_daily_brief"] : ["get_business_health_snapshot"];
}

function detectBusinessIntent(message: string) {
  if (env.AGENT_OWNER_DAILY_BRIEF_ENABLED && isOwnerDailyBriefIntentMessage(message)) {
    return "owner_daily_brief";
  }
  if (isService360Question(message)) {
    return "service_360";
  }
  if (/practitioner|therapist|doctor|ဆရာဝန်/i.test(message)) {
    return "practitioner_performance";
  }
  if (/daily treatment|treatment volume|ကုသမှု/i.test(message)) {
    return "daily_treatment";
  }
  if (/declining|trend|compare|ကျ/i.test(message)) {
    return "service_trend";
  }
  if (/service|ဝန်ဆောင်မှု/i.test(message)) {
    return "service_performance";
  }
  return "business_health";
}

function detectAppointmentIntent(message: string) {
  const asksAppointmentLedger = /appointment|appointments|booking|bookings|schedule|ချိန်း|ဘိုကင်/i.test(message) || isAppointmentLedgerQuestion(message);
  if (/waiting|not\s+(?:have\s+)?started|have\s+not\s+started|has\s+not\s+started|haven't\s+started|hasn't\s+started|မစ/i.test(message)) {
    return "waiting_customers";
  }
  if (/in progress|started treatment|ကုသနေ/i.test(message)) {
    return "treatment_in_progress";
  }
  if (/who|list|they|them|first|second|third|ဘယ်သူ/i.test(message) && /check[- ]?in|checked[- ]?in|checked in|arrived|ရောက်/i.test(message)) {
    return "checked_in_customers";
  }
  if (/check[- ]?out|completed|ပြီး/i.test(message)) {
    return "checked_out_customers";
  }
  if (/cancel|no[- ]?show|ဖျက်|မလာ/i.test(message)) {
    return "cancelled_no_show";
  }
  if (/trend|history|compare/i.test(message)) {
    return "appointment_trend";
  }
  if (/detail|first|second|third/i.test(message)) {
    return "appointment_detail";
  }
  if (/check[- ]?in|checked[- ]?in|checked in|arrived|ရောက်/i.test(message)) {
    return "checked_in_customers";
  }
  if (/live|right now|currently|\bnow\b|ယခု|အခု/i.test(message) && asksAppointmentLedger) {
    return "live_appointment_counts";
  }
  if (
    /who|what|which|list|show|view|display|all|scheduled|today|count|total|how many|customer|customers|member|members|service|services|practitioner|therapist|ဘယ်သူ|ဝန်ဆောင်မှု|ဖောက်သည်/i.test(
      message,
    ) &&
    asksAppointmentLedger
  ) {
    return /who|what|which|list|show|view|display|all|customer|customers|member|members|service|services|practitioner|therapist|ဘယ်သူ|ဝန်ဆောင်မှု|ဖောက်သည်/i.test(
      message,
    )
      ? "appointment_list"
      : "appointment_summary";
  }
  return "appointment_summary";
}

function toolsForIntent(agentId: GreatTimeAgentId, intent: string) {
  if (intent === "unsupported_write_request") {
    return [];
  }

  if (agentId === "finance") {
    switch (intent) {
      case "payment_summary":
      case "payment_method_breakdown":
        return ["get_payment_summary", "get_payment_method_breakdown"];
      case "sales_period_comparison":
        return ["compare_sales_periods"];
      case "customer_purchase_history":
        return ["get_customer_purchase_history"];
      case "customer_payment_history":
        return ["get_customer_payment_history"];
      case "invoice_detail":
        return ["get_invoice_detail"];
      default:
        return ["get_sales_summary"];
    }
  }

  if (agentId === "customer_relationship") {
    switch (intent) {
      case "customer_overview":
        return [
          "get_customer_overview",
          "get_customer_packages",
          "get_customer_bookings",
          "get_customer_payments",
          "get_customer_usage",
        ];
      case "customer_360":
        return ["get_customer_360"];
      case "customer_purchase_history":
        return ["get_customer_payments", "get_customer_packages"];
      case "unused_package_balance":
      case "unactivated_purchase":
      case "dormant_with_active_balance_90d":
      case "lapsed_customer_90d":
      case "reactivated_customer":
      case "package_bought_never_came":
      case "package_bought_not_used":
      case "package_bought_never_used":
      case "treatment_due":
      case "churn_risk":
      case "follow_up_today":
      case "top_customers":
        return ["search_customer_profiles"];
      default:
        return ["search_customer_profiles"];
    }
  }

  if (agentId === "business") {
    switch (intent) {
      case "owner_daily_brief":
        return toolsForBusinessOwnerDailyBrief();
      case "service_360":
        return ["get_service_360"];
      case "service_performance":
      case "service_trend":
        return ["get_service_behavior", "get_service_overview"];
      case "practitioner_performance":
        return ["get_practitioner_overview", "get_practitioner_treatments"];
      case "daily_treatment":
        return ["get_daily_treatments"];
      default:
        return ["get_business_health_snapshot"];
    }
  }

  switch (intent) {
    case "appointment_summary":
      return ["get_live_appointment_counts"];
    case "appointment_list":
      return ["get_appointment_ledger"];
    case "live_appointment_counts":
      return ["get_live_appointment_counts"];
    case "checked_in_customers":
      return ["get_checked_in_customers"];
    case "checked_out_customers":
      return ["get_checked_out_customers"];
    case "cancelled_no_show":
      return ["get_cancelled_no_show_customers"];
    case "waiting_customers":
    case "treatment_in_progress":
      return ["get_treatment_start_proxy"];
    case "appointment_detail":
      return ["get_appointment_detail"];
    case "appointment_trend":
      return ["get_appointment_trends"];
    default:
      return ["get_appointment_ledger"];
  }
}

export function planAgentRequest(params: {
  request: GreatTimeAgentChatRequest;
  now?: Date;
}): GreatTimeAgentIntentPlan {
  const requestedAgent = params.request.agent ?? "auto";
  const { resolvedAgent, autoMode } = resolveAgent({
    requestedAgent,
    message: params.request.message,
  });
  let period = extractAgentPeriod({
    message: params.request.message,
    fromDate: params.request.fromDate,
    toDate: params.request.toDate,
    timezone: params.request.timezone,
    now: params.now,
  });

  if (isUnsupportedWriteRequest(params.request.message)) {
    return {
      requestedAgent,
      resolvedAgent,
      autoMode,
      intent: "unsupported_write_request",
      toolNames: [],
      period,
      unsupportedReason: buildReadOnlyRefusalMessage(params.request.message),
    };
  }

  const intent =
    resolvedAgent === "finance"
      ? detectFinanceIntent(params.request.message)
        : resolvedAgent === "customer_relationship"
          ? detectCustomerIntent(params.request.message)
          : resolvedAgent === "business"
            ? detectBusinessIntent(params.request.message)
            : detectAppointmentIntent(params.request.message);

  if (
    resolvedAgent === "customer_relationship" &&
    ["unactivated_purchase", "package_bought_never_came", "package_bought_never_used", "package_bought_not_used"].includes(intent) &&
    !params.request.fromDate &&
    !params.request.toDate &&
    !hasExplicitPeriodCue(params.request.message)
  ) {
    period = buildPeriod(addDays(period.toDate, -364), period.toDate, "last 365 days");
  }

  return {
    requestedAgent,
    resolvedAgent,
    autoMode,
    intent,
    toolNames: toolsForIntent(resolvedAgent, intent),
    period,
  };
}
