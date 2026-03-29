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

function buildCustomerFollowUpMessage(params: {
  aiLanguage: AiLanguage;
  preferredService: string;
  rebookingStatus: CustomerRiskSignals["rebookingStatus"];
}) {
  const { aiLanguage, preferredService, rebookingStatus } = params;
  if (rebookingStatus === "onTrack" || rebookingStatus === "unknown") {
    return null;
  }

  if (isMyanmarLanguage(aiLanguage)) {
    return rebookingStatus === "overdue"
      ? `${preferredService || "service"} အတွက် နောက်တစ်ကြိမ်ချိန်းဆိုရန် အချိန်အဆင်ပြေပါက ကူညီစီစဉ်ပေးနိုင်ပါသည်။`
      : `${preferredService || "service"} အတွက် နောက်တစ်ကြိမ် booking ကို ကြိုတင်စီစဉ်ပေးနိုင်ပါသည်။`;
  }

  return rebookingStatus === "overdue"
    ? `We can help arrange your next ${preferredService || "service"} visit whenever convenient.`
    : `We can help secure your next ${preferredService || "service"} visit ahead of time.`;
}

export function buildCustomerInsightFallback(params: {
  aiLanguage: AiLanguage;
  overview: CustomerPortalOverviewResponse;
  riskSignals: CustomerRiskSignals;
}): CustomerInsightCore {
  const { aiLanguage, overview, riskSignals } = params;
  const customer = overview.customer;
  const serviceLabel =
    customer.preferredService ||
    (isMyanmarLanguage(aiLanguage) ? "အဓိက service pattern" : "the main service relationship");
  const therapistLabel =
    customer.preferredTherapist && customer.preferredTherapist !== "Unknown"
      ? customer.preferredTherapist
      : null;
  const topTherapist = overview.therapistRelationship[0];
  const totalTherapistVisits = overview.therapistRelationship.reduce((sum, row) => sum + row.visitCount, 0);
  const topTherapistShare =
    topTherapist && totalTherapistVisits > 0
      ? Number(((topTherapist.visitCount / totalTherapistVisits) * 100).toFixed(1))
      : null;
  const topCategory = overview.serviceMix[0];
  const totalCategoryVisits = overview.serviceMix.reduce((sum, row) => sum + row.visitCount, 0);
  const topCategoryShare =
    topCategory && totalCategoryVisits > 0
      ? Number(((topCategory.visitCount / totalCategoryVisits) * 100).toFixed(1))
      : null;
  const recentService = overview.recentServices[0]?.serviceName || serviceLabel;
  const formattedSpend = customer.lifetimeSpend.toLocaleString("en-US");
  const hasActivePackage = customer.remainingSessions > 0;
  const hasHealthyPackage = customer.remainingSessions > 3;
  const hasLowPackageBalance = customer.remainingSessions > 0 && customer.remainingSessions <= 3;
  const archetype = isMyanmarLanguage(aiLanguage)
    ? customer.spendTier === "VIP" && hasActivePackage
      ? "တန်ဖိုးမြင့် package customer"
      : topTherapistShare != null && topTherapistShare >= 60
        ? "Therapist အခြေပြု returning customer"
        : customer.categoryBreadth >= 3 && hasActivePackage
          ? "Service စုံအသုံးပြု renewal customer"
          : hasActivePackage
            ? "Package အခြေပြု repeat customer"
            : customer.totalVisits >= 8
              ? "တန်ဖိုးမြင့် continuity customer"
              : "Returning relationship customer"
    : customer.spendTier === "VIP" && hasActivePackage
      ? "Loyal package-driven customer"
      : topTherapistShare != null && topTherapistShare >= 60
        ? "Returning customer with therapist-led retention"
        : customer.categoryBreadth >= 3 && hasActivePackage
          ? "Broad-usage customer with renewal potential"
          : hasActivePackage
            ? "Package-led repeat customer"
            : customer.totalVisits >= 8
              ? "High-value continuity customer"
              : "Returning relationship customer";
  const relationshipNote = isMyanmarLanguage(aiLanguage)
    ? [
        therapistLabel
          ? `${therapistLabel} နှင့် continuity အားကောင်းနေပြီး${topTherapistShare != null ? ` tracked visits ၏ ${topTherapistShare}% ခန့်ကို ကိုင်တွယ်ထားပါသည်။` : " visit relationship ၏ အဓိကအချက်ဖြစ်ပါသည်။"}`
          : null,
        topCategory
          ? `${topCategory.serviceCategory} category အတွင်း အသုံးပြုမှု အများဆုံးဖြစ်ပြီး${topCategoryShare != null ? ` share ${topCategoryShare}% ခန့်ရှိပါသည်။` : " service mix အတွင်း အားကောင်းနေပါသည်။"}`
          : `${serviceLabel} ပတ်ဝန်းကျင်တွင် relationship အများဆုံးတွေ့ရပါသည်။`,
        hasActivePackage ? `Package လက်ကျန် ${customer.remainingSessions.toLocaleString("en-US")} ခုရှိနေပါသည်။` : null,
      ]
        .filter(Boolean)
        .join(" ")
    : [
        therapistLabel
          ? `${therapistLabel} is the clearest therapist anchor${topTherapistShare != null ? `, carrying about ${topTherapistShare}% of tracked visits.` : "."}`
          : null,
        topCategory
          ? `${topCategory.serviceCategory} is the strongest usage category${topCategoryShare != null ? ` at about ${topCategoryShare}% of tracked visits.` : "."}`
          : `${serviceLabel} is still the clearest service anchor.`,
        hasActivePackage ? `${customer.remainingSessions.toLocaleString("en-US")} package sessions remain active.` : null,
      ]
        .filter(Boolean)
        .join(" ");
  const riskNote = riskSignals.rebookingStatus === "overdue"
    ? isMyanmarLanguage(aiLanguage)
      ? "ပုံမှန်ပြန်လာချိန်ကို ကျော်သွားပြီးဖြစ်သောကြောင့် လက်ရှိ momentum လျော့နိုင်ပါသည်။"
      : "The customer is already past the expected return window, so current momentum could soften."
    : riskSignals.frequencyTrend === "declining"
      ? isMyanmarLanguage(aiLanguage)
        ? "မကြာသေးမီ 3 လအတွင်း လာရောက်မှု အင်အားသည် ယခင်ကာလထက် လျော့နေပါသည်။"
        : "Recent visit momentum is softer than the previous three-month window."
      : topTherapistShare != null && topTherapistShare >= 70
        ? isMyanmarLanguage(aiLanguage)
          ? `${topTherapist?.therapistName || therapistLabel} တစ်ဦးတည်းအပေါ် relationship များစွာမူတည်နေပါသည်။`
          : `The relationship is heavily dependent on ${topTherapist?.therapistName || therapistLabel}.`
        : !hasActivePackage && (customer.daysSinceLastVisit ?? 0) >= 45
          ? isMyanmarLanguage(aiLanguage)
            ? "Active package မရှိဘဲ visit gap ရှည်လာနေသောကြောင့် continuity အားပျော့နိုင်ပါသည်။"
            : "There is no active package and the visit gap is stretching, which can weaken continuity."
          : null;
  const opportunityNote = hasLowPackageBalance
    ? isMyanmarLanguage(aiLanguage)
      ? "Package လက်ကျန်နည်းလာနေသောကြောင့် နောက် booking နှင့် renewal conversation ကို တွဲစီစဉ်နိုင်ပါသည်။"
      : "Low remaining sessions make this a good moment to secure the next booking and prepare renewal."
    : hasHealthyPackage
      ? isMyanmarLanguage(aiLanguage)
        ? "Active package balance ကို အသုံးချပြီး နောက်တစ်ကြိမ်လာရောက်မှုကို လွယ်ကူစွာချိတ်နိုင်ပါသည်။"
        : "Active package balance gives the team a clean reason to secure the next visit."
      : customer.categoryBreadth <= 1 && customer.preferredServiceCategory !== "Other"
        ? isMyanmarLanguage(aiLanguage)
          ? `${customer.preferredServiceCategory} အပေါ် စုပုံနေသောကြောင့် related service cross-sell အခွင့်အလမ်းရှိပါသည်။`
          : `Usage is concentrated in ${customer.preferredServiceCategory.toLowerCase()}, so there is room for a related cross-sell.`
        : therapistLabel
          ? isMyanmarLanguage(aiLanguage)
            ? `${therapistLabel} နှင့် bond ကောင်းနေသောအချိန်တွင် နောက်တစ်ကြိမ် appointment ကို ကြိုတင်ချိတ်နိုင်ပါသည်။`
            : `The strong bond with ${therapistLabel} can be used to lock in the next appointment.`
          : null;

  if (isMyanmarLanguage(aiLanguage)) {
    return {
      customerArchetype: archetype,
      ownerSummary:
        customer.spendTier === "VIP"
          ? `ဤ customer သည် ${formattedSpend} lifetime spend နှင့် ${customer.totalVisits.toLocaleString("en-US")} visits ရှိသော တန်ဖိုးမြင့် returning record ဖြစ်ပါသည်။${customer.daysSinceLastVisit != null ? ` နောက်ဆုံးလာရောက်ပြီး ${customer.daysSinceLastVisit} ရက်ရှိပါပြီ။` : ""}`
          : `ဤ customer သည် ${customer.totalVisits.toLocaleString("en-US")} visits နှင့် ${formattedSpend} lifetime spend ရှိသော repeat relationship ဖြစ်ပါသည်။${customer.daysSinceLastVisit != null ? ` နောက်ဆုံးလာရောက်ပြီး ${customer.daysSinceLastVisit} ရက်ရှိပါပြီ။` : ""}`,
      businessMeaning:
        hasActivePackage
          ? "လုပ်ငန်းအရ ဤ customer သည် package usage မှတဆင့် ဆက်လက်ဝင်ငွေပြန်ရနိုင်သည့် retention record ဖြစ်ပါသည်။"
          : customer.totalVisits >= 8 || customer.spendTier === "VIP"
            ? "လုပ်ငန်းအရ ဤ customer သည် continuity ကို ထိန်းသိမ်းရမည့် တန်ဖိုးမြင့် repeat relationship ဖြစ်ပါသည်။"
            : "လုပ်ငန်းအရ ဤ customer သည် regular repeat demand ကို တည်ဆောက်နိုင်သည့် relationship ဖြစ်ပါသည်။",
      relationshipNote,
      riskNote,
      opportunityNote,
      recommendedAction:
        riskSignals.rebookingStatus === "overdue"
          ? `${recentService} အတွက် နောက်လာရောက်နိုင်မည့် slot ကို ချက်ချင်းကမ်းလှမ်းပြီး front desk follow-up စတင်ပါ။`
          : riskSignals.rebookingStatus === "dueSoon"
            ? `ပုံမှန်ပြန်လာချိန်မကျော်မီ ${recentService} အခြေပြု reminder ပို့ပြီး နောက် booking ကို ချိတ်ပါ။`
            : hasLowPackageBalance
              ? "နောက်လာရောက်မှုကို အတည်ပြုပြီး renewal conversation ကို ပျော့ပျော့စတင်ပါ။"
              : hasHealthyPackage
                ? "Active package balance ကို အသုံးချပြီး နောက်တစ်ကြိမ်လာရောက်မှုကို ကြိုတင်ချိတ်ပါ။"
                : therapistLabel
                  ? `${therapistLabel} နှင့် continuity မပျက်စေရန် next visit ကို အတည်ပြုပါ။`
                  : overview.recommendedAction,
      suggestedFollowUpMessage: buildCustomerFollowUpMessage({
        aiLanguage,
        preferredService: recentService,
        rebookingStatus: riskSignals.rebookingStatus,
      }),
    };
  }

  return {
    customerArchetype: archetype,
    ownerSummary:
      customer.spendTier === "VIP"
        ? `This is a high-value repeat customer with ${customer.totalVisits.toLocaleString("en-US")} visits and ${formattedSpend} in visible lifetime spend.${customer.daysSinceLastVisit != null ? ` The last visit was ${customer.daysSinceLastVisit} days ago.` : ""}`
        : `This customer has ${customer.totalVisits.toLocaleString("en-US")} visits and ${formattedSpend} in visible lifetime spend, which makes the record meaningfully repeat-led.${customer.daysSinceLastVisit != null ? ` The last visit was ${customer.daysSinceLastVisit} days ago.` : ""}`,
    businessMeaning:
      hasActivePackage
        ? "Commercially this record still carries future repeat revenue because package balance can convert into more visits."
        : customer.totalVisits >= 8 || customer.spendTier === "VIP"
          ? "Commercially this is a valuable continuity relationship worth protecting, not a one-off transaction."
          : "Commercially this is a repeat relationship that can still be strengthened through continuity and timely follow-up.",
    relationshipNote,
    riskNote,
    opportunityNote,
    recommendedAction:
      riskSignals.rebookingStatus === "overdue"
        ? `Have the front desk contact the customer now and offer the next available ${recentService} slot.`
        : riskSignals.rebookingStatus === "dueSoon"
          ? `Send a reminder before the usual return window closes and secure the next ${recentService} booking.`
          : hasLowPackageBalance
            ? "Secure the next visit now and start a soft renewal conversation while momentum is still warm."
            : hasHealthyPackage
              ? "Convert the active package balance into the next booked visit while the relationship is still warm."
              : therapistLabel
                ? `Protect continuity with ${therapistLabel} and lock in the next visit while the bond is strong.`
                : overview.recommendedAction,
    suggestedFollowUpMessage: buildCustomerFollowUpMessage({
      aiLanguage,
      preferredService: recentService,
      rebookingStatus: riskSignals.rebookingStatus,
    }),
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
