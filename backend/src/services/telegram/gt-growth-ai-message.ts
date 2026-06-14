import type {
  ReportAiEvidenceItem,
  ReportAiInsight,
  ReportAiPayload,
  ReportBusinessOpportunity,
  ReportNextAction,
} from "../../types/report-ai.js";

const DEFAULT_EVIDENCE_LIMIT = 3;
const DEFAULT_ACTION_LIMIT = 3;
const MAX_SUMMARY_LENGTH = 220;

function truncateText(value: string, maxLength = MAX_SUMMARY_LENGTH) {
  const text = value.trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1).trim()}…`;
}

function formatEvidenceValue(value: string | number) {
  return typeof value === "number" ? value.toLocaleString("en-US") : value;
}

function translateEvidenceLabel(label: string) {
  const normalized = label.trim().toLowerCase();
  const translations: Record<string, string> = {
    "today revenue": "ယနေ့ဝင်ငွေ",
    "previous day revenue": "မနေ့ကဝင်ငွေ",
    "last week revenue": "ပြီးခဲ့သည့်အပတ်ဝင်ငွေ",
    "this week revenue": "ယခုအပတ်ဝင်ငွေ",
    "revenue change": "ဝင်ငွေပြောင်းလဲမှု",
    "percentage change": "ရာခိုင်နှုန်းပြောင်းလဲမှု",
    "outstanding amount": "မရှင်းလင်းသေးသောငွေ",
    "affected invoices": "သက်ဆိုင်သော invoice",
    "package revenue today": "ယနေ့ package ဝင်ငွေ",
    "package revenue": "Package ဝင်ငွေ",
    "package sales count": "Package အရေအတွက်",
    "package revenue share": "Package ဝင်ငွေ share",
    "package revenue wow": "Package ဝင်ငွေ WoW",
    "top package": "ထိပ်ဆုံး package",
    "top service": "ထိပ်ဆုံး service",
    "revenue from top service": "ထိပ်ဆုံး service ဝင်ငွေ",
    "share of total revenue": "စုစုပေါင်းဝင်ငွေ share",
    "share of weekly revenue": "အပတ်စဉ်ဝင်ငွေ share",
    "service count": "Service အရေအတွက်",
    "average revenue per service": "Service တစ်ခုချင်း ပျမ်းမျှဝင်ငွေ",
    "current bookings for slot": "ထိုအချိန် booking",
    "busiest slot today": "ယနေ့အလုပ်များဆုံးချိန်",
    "recent same-weekday average appointments": "အလားတူ weekday ပျမ်းမျှ appointment",
    "no-show count": "No-show အရေအတွက်",
    "no-show rate": "No-show rate",
    "recent same-weekday no-show average": "အလားတူ weekday no-show ပျမ်းမျှ",
    "highest booked therapist": "Booking အများဆုံး therapist",
    "lowest booked therapist": "Booking အနည်းဆုံး therapist",
    "appointment count difference": "Appointment ကွာခြားချက်",
    "completed appointments": "ပြီးဆုံး appointment",
    "completed customers without future booking": "နောက် booking မရှိသော customer",
    "completed customers this week": "ယခုအပတ်ပြီးဆုံး customer",
    "customers without future booking": "နောက် booking မရှိသော customer",
    "estimated rebooking opportunity": "Rebooking အခွင့်အလမ်းတန်ဖိုး",
    "weakest day/time": "အားနည်းဆုံးနေ့/အချိန်",
    "booking count": "Booking အရေအတွက်",
    "revenue trend": "ဝင်ငွေ trend",
    "appointment trend": "Appointment trend",
    "top therapist": "ထိပ်ဆုံး therapist",
  };

  return translations[normalized] ?? label;
}

function formatEvidenceLine(item: ReportAiEvidenceItem) {
  const comparison = item.comparison ? ` (${item.comparison})` : "";
  return `- ${translateEvidenceLabel(item.label)}: ${formatEvidenceValue(item.value)}${comparison}`;
}

function getPrimaryInsight(payload: ReportAiPayload) {
  return payload.insights.find((item) => item.severity === "critical") ??
    payload.insights.find((item) => item.severity === "warning") ??
    payload.insights[0] ??
    null;
}

function buildMyanmarSummaryFromOpportunity(opportunity: ReportBusinessOpportunity) {
  switch (opportunity.opportunityType) {
    case "collection":
      return "Payment မရှင်းလင်းသေးသောအချက်ရှိနေသဖြင့် ပိတ်ချိန်မတိုင်မီ follow-up လုပ်ရန် အရေးကြီးပါသည်။";
    case "package_sales":
      return "Package ဝင်ငွေ အခွင့်အလမ်းရှိနေသဖြင့် repeat customer များကို package offer ပြန်လုပ်နိုင်ပါသည်။";
    case "rebooking":
      return "ပြီးဆုံးထားသော customer များတွင် နောက် appointment ပြန်ချိတ်နိုင်သည့် အခွင့်အလမ်းရှိပါသည်။";
    case "schedule_utilization":
      return "အားနည်းနေသော schedule slot ကို promotion သို့မဟုတ် follow-up ဖြင့် ဖြည့်နိုင်ပါသည်။";
    case "staff_performance":
      return "Staff performance ကွာခြားချက်ရှိနေသဖြင့် sales/process ကို ပြန်စစ်နိုင်ပါသည်။";
    case "customer_retention":
      return "Customer retention အခွင့်အလမ်းရှိနေသဖြင့် follow-up ကို အချိန်မီလုပ်သင့်ပါသည်။";
    case "revenue_growth":
    default:
      return "ဝင်ငွေတိုးတက်စေနိုင်သော service သို့မဟုတ် sales lever ကို ထပ်မံအသုံးချနိုင်ပါသည်။";
  }
}

function buildMyanmarSummaryFromInsight(insight: ReportAiInsight) {
  switch (insight.id) {
    case "daily-payment-revenue-drop":
    case "weekly-summary-revenue-risk":
      return "ဝင်ငွေသည် နှိုင်းယှဉ်ကာလထက် လျော့နေသဖြင့် service, package, appointment အလိုက် အကြောင်းရင်းကို စစ်ဆေးသင့်ပါသည်။";
    case "daily-payment-collection-risk":
      return "မရှင်းလင်းသေးသော payment ရှိနေသဖြင့် ပိတ်ချိန်မတိုင်မီ follow-up လုပ်ရန်လိုပါသည်။";
    case "daily-payment-package-sales-opportunity":
    case "weekly-summary-package-sales":
      return "Package sales အချက်အလက်တွေ့ရသဖြင့် package offer strategy ကို ဆက်အသုံးချနိုင်ပါသည်။";
    case "daily-payment-top-service-revenue-driver":
    case "weekly-summary-top-service-revenue-driver":
      return "ထိပ်ဆုံး service သည် ဝင်ငွေကို မောင်းနှင်နေသဖြင့် အားနည်းသောအချိန်တွင် ထပ်မံ promote လုပ်နိုင်ပါသည်။";
    case "daily-appointment-underutilized-slot":
    case "weekly-summary-underutilized-pattern":
      return "Schedule အတွင်း အားနည်းနေသောအချိန်ရှိသဖြင့် promotion သို့မဟုတ် customer follow-up ဖြင့် ဖြည့်နိုင်ပါသည်။";
    case "daily-appointment-no-show-risk":
      return "No-show signal မြင့်နေသဖြင့် ကျန် appointment များကို confirm လုပ်ရန်လိုပါသည်။";
    case "daily-appointment-therapist-load-imbalance":
      return "Therapist schedule မညီမျှနေသဖြင့် flexible booking နှင့် walk-in assignment ကို ပြန်ညှိသင့်ပါသည်။";
    case "daily-appointment-rebooking-opportunity":
    case "weekly-summary-rebooking-opportunity":
      return "နောက် booking မရှိသေးသော completed customer များကို rebook လုပ်နိုင်သည့် အခွင့်အလမ်းရှိပါသည်။";
    case "weekly-summary-growth":
      return "ယခုအပတ် performance တိုးတက်နေသဖြင့် အလုပ်ဖြစ်သော strategy ကို နောက်အပတ်တွင် ပြန်အသုံးချသင့်ပါသည်။";
    case "weekly-summary-cancellation-risk":
      return "Cancellation တိုးနေသဖြင့် reminder process နှင့် customer confirmation ကို ပြန်စစ်သင့်ပါသည်။";
    default:
      return truncateText(insight.summary);
  }
}

function buildMyanmarSummary(payload: ReportAiPayload) {
  if (payload.businessOpportunity) {
    return buildMyanmarSummaryFromOpportunity(payload.businessOpportunity);
  }

  const insight = getPrimaryInsight(payload);
  if (insight) {
    return buildMyanmarSummaryFromInsight(insight);
  }

  return truncateText(payload.summary || "ယနေ့ report အချက်အလက်ပေါ်မူတည်ပြီး လုပ်ဆောင်ရန်အချက်များကို စစ်ဆေးပါ။");
}

function formatMyanmarAction(action: ReportNextAction) {
  switch (action.actionType) {
    case "review_revenue_drop":
      return "ယနေ့ဝင်ငွေလျော့ကျမှုကို service/package/appointment အလိုက် စစ်ဆေးပါ";
    case "follow_up_payment":
      return "မရှင်းလင်းသေးသော payment များကို ပိတ်ချိန်မတိုင်မီ follow-up လုပ်ပါ";
    case "promote_time_slot": {
      const slot = action.title.replace(/^Promote\s+/i, "").trim();
      return slot && slot !== action.title ? `${slot} အချိန်ပိုင်းကို promotion လုပ်ပါ` : "အားနည်းနေသော time slot ကို promotion လုပ်ပါ";
    }
    case "review_staff_utilization":
      return "Therapist schedule/load ကို ပြန်ညှိပါ";
    case "send_reminder":
      return "ကျန် appointment များကို reminder ပို့ပြီး confirm လုပ်ပါ";
    case "rebook_customer": {
      const count = action.title.match(/\d[\d,]*/)?.[0];
      return count ? `နောက် booking မရှိသော customer ${count} ဦးကို rebook လုပ်ပါ` : "နောက် booking မရှိသော customer များကို rebook လုပ်ပါ";
    }
    case "call_customer":
      return "Follow-up လိုသော customer များကို ဆက်သွယ်ပါ";
    default:
      return truncateText(action.title);
  }
}

function getEvidence(payload: ReportAiPayload, limit: number) {
  const source = payload.businessOpportunity?.evidence.length
    ? payload.businessOpportunity.evidence
    : (getPrimaryInsight(payload)?.evidence ?? []);

  return source.slice(0, limit);
}

function formatBusinessOpportunity(opportunity: ReportBusinessOpportunity | null) {
  if (!opportunity) {
    return null;
  }

  const valueText = opportunity.estimatedValueLabel
    ? ` (${opportunity.estimatedValueLabel})`
    : opportunity.estimatedValue != null
      ? ` (${[opportunity.estimatedValue.toLocaleString("en-US"), opportunity.currency].filter(Boolean).join(" ")})`
      : "";

  switch (opportunity.opportunityType) {
    case "collection":
      return `မရှင်းလင်းသေးသော payment ကို ပိတ်ချိန်မတိုင်မီ follow-up လုပ်ပါ${valueText}`;
    case "package_sales":
      return `Package offer ကို repeat customer များအပေါ် ပြန်အသုံးချပါ${valueText}`;
    case "rebooking":
      return `နောက် booking မရှိသော customer များကို 48 နာရီအတွင်း ပြန်ဆက်သွယ်ပါ${valueText}`;
    case "schedule_utilization":
      return `အားနည်းနေသော schedule slot ကို targeted promotion ဖြင့် ဖြည့်ပါ${valueText}`;
    case "staff_performance":
      return `Staff performance ကွာခြားချက်ကို process/training ဖြင့် ပြန်ညှိပါ${valueText}`;
    case "customer_retention":
      return `Customer retention အတွက် follow-up ကို ဦးစားပေးလုပ်ပါ${valueText}`;
    case "revenue_growth":
    default:
      return `ဝင်ငွေတိုးနိုင်သော service/sales lever ကို ထပ်မံ promote လုပ်ပါ${valueText}`;
  }
}

export function formatGtGrowthAiTelegramSection(
  payload: ReportAiPayload | null | undefined,
  options: { evidenceLimit?: number; actionLimit?: number } = {},
) {
  if (!payload) {
    return [];
  }

  const hasPremiumContent =
    payload.summary.trim() ||
    payload.insights.length > 0 ||
    payload.nextActions.length > 0 ||
    payload.businessOpportunity;

  if (!hasPremiumContent) {
    return [];
  }

  const evidence = getEvidence(payload, options.evidenceLimit ?? DEFAULT_EVIDENCE_LIMIT);
  const opportunity = formatBusinessOpportunity(payload.businessOpportunity);
  const actions = payload.nextActions.slice(0, options.actionLimit ?? DEFAULT_ACTION_LIMIT);
  const lines = ["🤖 GT Growth AI", `အကျဉ်းချုပ်: ${buildMyanmarSummary(payload)}`];

  if (evidence.length > 0) {
    lines.push("ဘာကြောင့်အရေးကြီးလဲ:");
    evidence.forEach((item) => lines.push(formatEvidenceLine(item)));
  }

  if (opportunity) {
    lines.push("လုပ်ငန်းအခွင့်အလမ်း:");
    lines.push(`- ${opportunity}`);
  }

  if (actions.length > 0) {
    lines.push("လုပ်ဆောင်ရန်:");
    actions.forEach((action, index) => {
      lines.push(`${index + 1}. ${formatMyanmarAction(action)}`);
    });
  }

  return lines;
}
