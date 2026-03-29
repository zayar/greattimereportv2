import type { DashboardResponse, CustomerPortalOverviewResponse, ServicePortalOverviewResponse } from "../../types/ai-source.js";
import { isMyanmarLanguage, type AiLanguage } from "./language.js";
import type {
  CustomerInsightCore,
  ExecutiveSummaryCore,
  ServiceInsightCore,
} from "./schemas.js";
import type { CustomerRiskSignals } from "./customer-risk.service.js";

function trimList(items: Array<string | null | undefined>, max = 3) {
  return items
    .map((item) => item?.trim() ?? "")
    .filter(Boolean)
    .slice(0, max);
}

function signedPercent(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function topServiceNames(services: DashboardResponse["topServices"]) {
  return services.slice(0, 2).map((service) => service.serviceName).filter(Boolean);
}

export function buildExecutiveSummaryFallback(params: {
  aiLanguage: AiLanguage;
  dashboard: DashboardResponse;
}): ExecutiveSummaryCore {
  const { aiLanguage, dashboard } = params;
  const revenueChange = dashboard.summary.revenue.change;
  const customersChange = dashboard.summary.customers.change;
  const appointmentsChange = dashboard.summary.appointments.change;
  const services = topServiceNames(dashboard.topServices);
  const topService = dashboard.topServices[0];
  const topPaymentMethod = dashboard.paymentMix[0];
  const warning =
    appointmentsChange <= -10
      ? aiLanguage === "my-MM"
        ? "Appointment ဝင်ရောက်မှု လျော့နေပါသည်။ Follow-up နှင့် rebooking flow ကို စစ်ဆေးပါ။"
        : "Appointment volume is softening. Review follow-up and rebooking flow."
      : topPaymentMethod && topPaymentMethod.contributionPct >= 60
        ? aiLanguage === "my-MM"
          ? `${topPaymentMethod.paymentMethod} payment mix ပိုမိုစုနေပါသည်။ Collection mix ကို စောင့်ကြည့်ပါ။`
          : `${topPaymentMethod.paymentMethod} is heavily concentrated in the payment mix. Monitor collection mix.`
        : null;

  if (isMyanmarLanguage(aiLanguage)) {
    return {
      summaryTitle: revenueChange >= 0 ? "လုပ်ငန်းအကျဉ်းချုပ်" : "လုပ်ငန်းသတိပြုရန် အချက်",
      summaryText:
        revenueChange >= 0
          ? `ရွေးထားသောကာလအတွင်း ဝင်ငွေ ${signedPercent(revenueChange)} တိုးလာပါသည်။${services.length ? ` အဓိကမောင်းနှင်သည့် service များမှာ ${services.join(" နှင့် ")} ဖြစ်ပါသည်။` : ""}`
          : `ရွေးထားသောကာလအတွင်း ဝင်ငွေ ${signedPercent(revenueChange)} ပြောင်းလဲထားပြီး booking အင်အားကို ပြန်စစ်ရန်လိုပါသည်။`,
      topFindings: trimList([
        topService
          ? `${topService.serviceName} က ဝင်ငွေ၏ ${topService.contributionPct.toFixed(1)}% ကို ပံ့ပိုးထားပါသည်။`
          : null,
        `Customer activity ${signedPercent(customersChange)} ပြောင်းလဲထားပါသည်။`,
        `Appointment volume ${signedPercent(appointmentsChange)} ပြောင်းလဲထားပါသည်။`,
      ]),
      recommendedActions: trimList([
        appointmentsChange < 0
          ? "Overdue customer follow-up နှင့် rebooking reminder ကို တင်းကျပ်စွာ ပြန်စစ်ပါ။"
          : "အကောင်းဆုံးလုပ်ဆောင်နေသည့် service များအတွက် follow-up cadence ကို ဆက်ထိန်းပါ။",
        topService && topService.contributionPct >= 35
          ? `${topService.serviceName} အပေါ် များစွာမူတည်နေသောကြောင့် capacity နှင့် promotion balance ကို ပြန်စစ်ပါ။`
          : "Top service အုပ်စုအတွက် package renewal နှင့် cross-sell အခွင့်အလမ်းကို ပြန်ကြည့်ပါ။",
        topPaymentMethod && topPaymentMethod.contributionPct >= 60
          ? "Payment concentration များနေသောကြောင့် collection mix ကို ပိုမိုမျှတအောင် စောင့်ကြည့်ပါ။"
          : "Clinic owner အတွက် short weekly review cadence တစ်ခုသတ်မှတ်ပါ။",
      ]),
      warningText: warning,
    };
  }

  return {
    summaryTitle: revenueChange >= 0 ? "Business snapshot" : "Performance watch",
    summaryText:
      revenueChange >= 0
        ? `Revenue moved ${signedPercent(revenueChange)} in the selected window.${services.length ? ` ${services.join(" and ")} were the main service drivers.` : ""}`
        : `Revenue moved ${signedPercent(revenueChange)} in the selected window and booking momentum needs attention.`,
    topFindings: trimList([
      topService
        ? `${topService.serviceName} contributed ${topService.contributionPct.toFixed(1)}% of visible revenue.`
        : null,
      `Customer activity moved ${signedPercent(customersChange)} versus the comparison window.`,
      `Appointment volume moved ${signedPercent(appointmentsChange)} versus the comparison window.`,
    ]),
    recommendedActions: trimList([
      appointmentsChange < 0
        ? "Tighten overdue follow-up and rebooking reminders."
        : "Keep follow-up discipline around the strongest services.",
      topService && topService.contributionPct >= 35
        ? `Protect capacity around ${topService.serviceName} because revenue is concentrated there.`
        : "Review package renewal and cross-sell opportunities in the leading services.",
      topPaymentMethod && topPaymentMethod.contributionPct >= 60
        ? "Monitor payment concentration so collections are not over-dependent on one method."
        : "Keep a short weekly owner review on the key dashboard signals.",
    ]),
    warningText: warning,
  };
}

function buildCustomerFollowUpMessage(aiLanguage: AiLanguage, rebookingStatus: CustomerRiskSignals["rebookingStatus"]) {
  if (rebookingStatus === "onTrack" || rebookingStatus === "unknown") {
    return null;
  }

  if (isMyanmarLanguage(aiLanguage)) {
    return rebookingStatus === "overdue"
      ? "ပြန်လည်ချိန်းဆိုရန် အချိန်အဆင်ပြေပါက ဆက်သွယ်ပေးနိုင်ပါသည်။"
      : "နောက်တစ်ကြိမ် booking အတွက် အချိန်ကြိုတင်ထားနိုင်ပါသည်။";
  }

  return rebookingStatus === "overdue"
    ? "We can help arrange your next booking whenever convenient."
    : "We can help secure your next booking ahead of time.";
}

export function buildCustomerInsightFallback(params: {
  aiLanguage: AiLanguage;
  overview: CustomerPortalOverviewResponse;
  riskSignals: CustomerRiskSignals;
}): CustomerInsightCore {
  const { aiLanguage, overview, riskSignals } = params;
  const customer = overview.customer;
  const serviceLabel = customer.preferredService || (isMyanmarLanguage(aiLanguage) ? "ဤ customer ၏ အဓိက service pattern" : "this customer's main service pattern");
  const therapistLabel =
    customer.preferredTherapist && customer.preferredTherapist !== "Unknown"
      ? customer.preferredTherapist
      : null;
  const hasHealthyPackage = customer.remainingSessions > 3;
  const hasLowPackageBalance = customer.remainingSessions > 0 && customer.remainingSessions <= 3;
  const recentActivityLine =
    riskSignals.daysSinceLastVisit == null
      ? null
      : riskSignals.daysSinceLastVisit <= 14
        ? isMyanmarLanguage(aiLanguage)
          ? "မကြာသေးမီက လာရောက်ထားသဖြင့် customer relationship သည် လက်ရှိတက်ကြွနေဆဲဖြစ်ပါသည်။"
          : "The customer visited recently, so the relationship still looks active."
        : riskSignals.daysSinceLastVisit <= 45
          ? isMyanmarLanguage(aiLanguage)
            ? `နောက်ဆုံးလာရောက်ပြီး ${riskSignals.daysSinceLastVisit} ရက်ရှိထားသဖြင့် follow-up timing ကို စီမံနိုင်သေးပါသည်။`
            : `It has been ${riskSignals.daysSinceLastVisit} days since the last visit, so follow-up timing is still manageable.`
          : isMyanmarLanguage(aiLanguage)
            ? `နောက်ဆုံးလာရောက်မှုမှ ${riskSignals.daysSinceLastVisit} ရက်ကျော်သွားသဖြင့် relationship ကို ပြန်နိုးဆော်ရန်လိုပါသည်။`
            : `It has been ${riskSignals.daysSinceLastVisit} days since the last visit, so the relationship needs a stronger follow-up push.`;

  if (isMyanmarLanguage(aiLanguage)) {
    return {
      nextBestAction:
        riskSignals.rebookingStatus === "overdue"
          ? "ပြန်လည်လာရောက်မှုကို အမြန်ပြန်ချိတ်ပြီး အချိန်ရွေးချယ်နိုင်သော slot ကို ချက်ချင်းပေးပါ။"
          : riskSignals.rebookingStatus === "dueSoon"
            ? "ပုံမှန်ပြန်လာချိန်မကျော်မီ reminder ပို့ပြီး နောက်တစ်ကြိမ် booking ကို စီစဉ်ပါ။"
            : hasHealthyPackage
              ? "Package usage ဆက်လက်လှုပ်ရှားနေစေရန် continuity follow-up လုပ်ပြီး renewal timing ကို စောင့်ကြည့်ပါ။"
              : hasLowPackageBalance
                ? "Package လက်ကျန်နည်းနေသောကြောင့် နောက်တစ်ကြိမ်လာရောက်ချိန်နှင့် renewal conversation ကို ပြင်ဆင်ပါ။"
                : therapistLabel
                  ? `${therapistLabel} နှင့် continuity ကို ထိန်းသိမ်းပြီး နောက်လာရောက်မှုအတွက် light check-in လုပ်ပါ။`
                  : "ပုံမှန် customer relationship check-in တစ်ခုလုပ်ပြီး နောက်လာရောက်နိုင်မည့် service ကို သေချာအတည်ပြုပါ။",
      shortExplanation: [
        recentActivityLine,
        hasHealthyPackage
          ? `Package လက်ကျန် ${customer.remainingSessions.toLocaleString("en-US")} ခုရှိနေသေးသောကြောင့် ဆက်လက်အသုံးပြုမှုနှင့် continuity ကို ထိန်းနိုင်ပါသည်။`
          : hasLowPackageBalance
            ? `Package လက်ကျန် ${customer.remainingSessions.toLocaleString("en-US")} ခုသာကျန်သဖြင့် renewal timing ကို စတင်ကြည့်သင့်ပါသည်။`
            : `${serviceLabel} ကို အဓိကထားအသုံးပြုနေသဖြင့် နောက်တစ်ကြိမ်ပြန်လာမှုကို business follow-up ဖြင့်ထိန်းသိမ်းသင့်ပါသည်။`,
        therapistLabel
          ? `${therapistLabel} နှင့် relationship သည် continuity အတွက် အားသာချက်တစ်ခုဖြစ်ပါသည်။`
          : riskSignals.frequencyTrend === "declining"
            ? "မကြာသေးမီလာရောက်မှု အင်အား လျော့နေသောကြောင့် owner review ထဲတွင် ထည့်သွင်းစောင့်ကြည့်သင့်ပါသည်။"
            : null,
      ]
        .filter(Boolean)
        .join(" "),
      suggestedFollowUpMessage: buildCustomerFollowUpMessage(aiLanguage, riskSignals.rebookingStatus),
    };
  }

  return {
    nextBestAction:
      riskSignals.rebookingStatus === "overdue"
        ? "Reconnect now and offer a clear next-visit slot while the relationship is still warm."
        : riskSignals.rebookingStatus === "dueSoon"
          ? "Send a reminder before the usual return window closes and guide the next booking."
          : hasHealthyPackage
            ? "Keep package usage moving and watch for the right renewal timing."
            : hasLowPackageBalance
              ? "Prepare the next visit and start a soft renewal conversation because package balance is getting low."
              : therapistLabel
                ? `Protect continuity with ${therapistLabel} and keep a light relationship check-in.`
                : "Keep the customer in a light follow-up cadence and confirm the next likely service.",
    shortExplanation: [
      recentActivityLine,
      hasHealthyPackage
        ? `Package balance is still active with ${customer.remainingSessions.toLocaleString("en-US")} sessions remaining, which supports continuity.`
        : hasLowPackageBalance
          ? `Package balance is down to ${customer.remainingSessions.toLocaleString("en-US")} sessions, so renewal timing is getting closer.`
          : `${serviceLabel} remains the clearest service relationship, so the next visit should be guided around that pattern.`,
      therapistLabel
        ? `${therapistLabel} is the strongest therapist relationship for continuity.`
        : riskSignals.frequencyTrend === "declining"
          ? "Recent visit momentum is softer than the prior three-month window and should stay on the owner watchlist."
          : null,
    ]
      .filter(Boolean)
      .join(" "),
    suggestedFollowUpMessage: buildCustomerFollowUpMessage(aiLanguage, riskSignals.rebookingStatus),
  };
}

export function buildServiceInsightFallback(params: {
  aiLanguage: AiLanguage;
  overview: ServicePortalOverviewResponse;
}): ServiceInsightCore {
  const { aiLanguage, overview } = params;
  const service = overview.service;
  const staffingObservation =
    service.topTherapist !== "Unknown" && service.topTherapistShare >= 55
      ? isMyanmarLanguage(aiLanguage)
        ? `${service.topTherapist} အပေါ် booking အား ${service.topTherapistShare.toFixed(1)}% စုနေသောကြောင့် team readiness ကို ပြန်ညှိပါ။`
        : `${service.topTherapist} carries ${service.topTherapistShare.toFixed(1)}% of visible bookings, so team readiness should be reviewed.`
      : null;

  if (isMyanmarLanguage(aiLanguage)) {
    return {
      shortSummary: `${service.serviceName} သည် ရွေးထားသောကာလအတွင်း ဝင်ငွေ ${service.totalRevenue.toLocaleString("en-US")} ကို ရရှိထားပြီး booking ${service.bookingCount.toLocaleString("en-US")} ကြိမ်ရှိပါသည်။`,
      growthInsight:
        service.growthRate >= 0
          ? `ယခင်ကာလနှိုင်းယှဉ်လျှင် growth ${service.growthRate.toFixed(1)}% ဖြစ်ပါသည်။`
          : `ယခင်ကာလနှိုင်းယှဉ်လျှင် growth ${service.growthRate.toFixed(1)}% ဖြစ်ပြီး demand ကို သတိထားရန်လိုပါသည်။`,
      repeatRateInsight:
        service.repeatPurchaseRate >= 35
          ? `Repeat rate ${service.repeatPurchaseRate.toFixed(1)}% ဖြစ်သောကြောင့် ပြန်လာမှုအခြေခံကောင်းပါသည်။`
          : `Repeat rate ${service.repeatPurchaseRate.toFixed(1)}% သာရှိသဖြင့် rebooking follow-up ကို ပိုကောင်းအောင်လုပ်နိုင်ပါသည်။`,
      packageOpportunity:
        service.packageMixPct >= 40
          ? `Package mix ${service.packageMixPct.toFixed(1)}% ဖြစ်ပြီး continuity demand ရှိနေပါသည်။`
          : `Package mix ${service.packageMixPct.toFixed(1)}% သာရှိသဖြင့် repeat service အဖြစ် package promotion စဉ်းစားနိုင်ပါသည်။`,
      staffingObservation,
      recommendedActions: trimList([
        service.repeatPurchaseRate < 25
          ? "Rebooking reminder flow ကို service-specific အဖြစ်ပြန်တည်ဆောက်ပါ။"
          : "Repeat customers အတွက် package renewal follow-up ကို ဆက်ထိန်းပါ။",
        service.topTherapistShare >= 60
          ? "Therapist skill distribution ကို ပြန်ညှိပြီး dependency လျှော့ချပါ။"
          : "Booking demand အလိုက် staffing capacity ကို ပုံမှန်စစ်ဆေးပါ။",
        service.packageMixPct < 25 && service.repeatPurchaseRate >= 25
          ? "Package offer တစ်ခုကို premium positioning နဲ့ စမ်းသပ်ပါ။"
          : "Price, mix, and promotion ကို အပတ်စဉ် owner review ထဲထည့်ပါ။",
      ]),
    };
  }

  return {
    shortSummary: `${service.serviceName} delivered ${service.bookingCount.toLocaleString("en-US")} bookings and ${service.totalRevenue.toLocaleString("en-US")} in visible revenue during the selected window.`,
    growthInsight:
      service.growthRate >= 0
        ? `Growth is ${service.growthRate.toFixed(1)}% versus the previous comparison window.`
        : `Growth is ${service.growthRate.toFixed(1)}% versus the previous comparison window and demand needs attention.`,
    repeatRateInsight:
      service.repeatPurchaseRate >= 35
        ? `Repeat rate is ${service.repeatPurchaseRate.toFixed(1)}%, which shows a strong return base.`
        : `Repeat rate is ${service.repeatPurchaseRate.toFixed(1)}%, so rebooking follow-up can improve.`,
    packageOpportunity:
      service.packageMixPct >= 40
        ? `Package mix is already ${service.packageMixPct.toFixed(1)}%, which suggests planned continuity demand.`
        : `Package mix is ${service.packageMixPct.toFixed(1)}%, so there may be room for a stronger package offer.`,
    staffingObservation,
    recommendedActions: trimList([
      service.repeatPurchaseRate < 25
        ? "Tighten the service-specific rebooking reminder flow."
        : "Keep package renewal and repeat follow-up active for returning customers.",
      service.topTherapistShare >= 60
        ? "Broaden therapist readiness so performance is not concentrated in one person."
        : "Review staffing capacity against visible demand.",
      service.packageMixPct < 25 && service.repeatPurchaseRate >= 25
        ? "Test a premium package offer for repeat-friendly customers."
        : "Keep price, mix, and promotion in the weekly owner review.",
    ]),
  };
}
