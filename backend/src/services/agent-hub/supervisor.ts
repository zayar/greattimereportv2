import type { GreatTimeAgentId, GreatTimeRequestedAgentId } from "./types.js";
import { extractLikelyCustomerSearchText, hasExplicitCustomerSearchIntent } from "./customer-query.js";
import { hasPaymentMethodReference } from "./payment-method-intent.js";
import { isAppointmentRosterQuestion, isOperationsCountReconciliationQuestion, isTreatmentRosterQuestion } from "./question-dimensions.js";
import { hasExplicitServiceSearchIntent } from "./service-query.js";
import { isTreatmentDetailQuestion } from "./treatment-detail-intent.js";

const AGENT_ORDER: GreatTimeAgentId[] = ["finance", "customer_relationship", "business", "appointment"];

const KEYWORDS: Record<GreatTimeAgentId, RegExp[]> = {
  finance: [
    /sales?|revenue|income|turnover|invoice|transactions?|transcriptions?|payment|collection|collected|received|cash|bank|wallet|kpay|kpaye|kbz|wavepay|wave|mmqr|\bqr\b|cbpay|ayapay|mpu|visa|master\s*card|mastercard|purchase|refund/i,
    /ရောင်း|ဝင်ငွေ|ငွေ|ပေးချေ|ဘဏ်|အကြွေး|ငွေသား|ဘယ်လောက်|ဝင်လဲ|ဝင်|ရလဲ|အသေးစိတ်|စာရင်း/i,
  ],
  customer_relationship: [
    /customer|member|vip|package|package balance|inactive|churn|risk|treatment due|follow[- ]?up|preference|retention/i,
    /ဖောက်သည်|မန်ဘာ|ပက်ကေ့|လက်ကျန်|မလာ|ဆက်သွယ်|အန္တရာယ်|ကုသမှု/i,
  ],
  business: [
    /business|trend|performance|service|practitioner|therapist|doctor|utilization|clinic|growth|declining|volume/i,
    /လုပ်ငန်း|ဝန်ဆောင်မှု|ဆရာဝန်|therapist|ဆိုင်|တိုး|ကျ/i,
  ],
  appointment: [
    /appointment|booking|booked|arrival|arrived|check[- ]?in|checked in|check[- ]?out|checked out|checkout|completed|finished|waiting|no[- ]?show|cancel/i,
    /ချိန်း|ဘိုကင်|ရောက်|check in|check out|checkout|ပြီးဆုံး|ပြီးသွား|မပြီး|မလုပ်သေး|မလာ|ဖျက်/i,
  ],
};

function scoreAgent(message: string, agentId: GreatTimeAgentId) {
  return KEYWORDS[agentId].reduce((score, keyword) => score + (keyword.test(message) ? 1 : 0), 0);
}

export function isAppointmentLedgerQuestion(message: string) {
  const mentionsAppointment = /appointment|appointments|booking|bookings|schedule|ချိန်း|ဘိုကင်/i.test(message);
  const mentionsToday = /today|\bnow\b|right now|this\s+(?:morning|afternoon|evening)|ဒီနေ့|ယနေ့|အခု|ယခု/i.test(message);
  const asksLifecycleRoster =
    /check[- ]?in|checked in|arrived|check[- ]?out|checked out|checkout|not\s+(?:checked\s*out|finished|completed)|completed|finished|မပြီး|မလုပ်သေး|checkout\s*မလုပ်|check-out\s*မလုပ်|ရောက်ပြီး[\s\S]{0,40}(?:treatment|process)?\s*မစ|ကုသမှု\s*မစ|မစသေး/i.test(
      message,
    ) &&
    /today|\bnow\b|right now|who|which|list|show|customers?|members?|ဒီနေ့|ယနေ့|အခု|ယခု|ဘယ်သူ|customer|ဖောက်သည်/i.test(
      message,
    );
  const asksWhoIsComingToday =
    /(?:who|which\s+customers?|customers?|members?)[\s\S]{0,80}(?:coming|come|arriv(?:e|ing)|visit(?:ing)?)[\s\S]{0,80}today|today[\s\S]{0,80}(?:who|which\s+customers?|customers?|members?)[\s\S]{0,80}(?:coming|come|arriv(?:e|ing)|visit(?:ing)?)|ဘယ်သူ[\s\S]{0,80}(?:ဒီနေ့|ယနေ့)[\s\S]{0,80}လာ|(?:ဒီနေ့|ယနေ့)[\s\S]{0,80}ဘယ်သူ[\s\S]{0,80}လာ/i.test(
      message,
    );
  const asksCustomerServiceRoster =
    mentionsToday &&
    /customer|customers|member|members|who|which|ဘယ်သူ|ဖောက်သည်/i.test(message) &&
    /service|services|therapist|therapists|practitioner|practitioners|doctor|ဝန်ဆောင်မှု|ဆရာဝန်|ကုသ/i.test(message) &&
    /doing|do|getting|taking|with|for|handle|handled|assigned|လုပ်|ကုသ|လာ/i.test(message);
  const asksLedgerDetail =
    /today|ဒီနေ့|who|what|which|list|show|all|customer|customers|member|members|service|services|therapist|therapists|practitioner|practitioners|ဘယ်သူ|ဝန်ဆောင်မှု|ဖောက်သည်/i.test(
      message,
    );
  const asksFinance =
    /sales?|revenue|income|turnover|transactions?|payment|collection|collected|received|invoice|kpay|kpaye|wavepay|wave|mmqr|\bqr\b|cbpay|ayapay|mpu|visa|master\s*card|mastercard|purchase|purchased|bought|buy|ငွေ|ရောင်း|ဝင်ငွေ|ဝယ်|ဘယ်လောက်|ဝင်လဲ|ဝင်|ရလဲ|အသေးစိတ်|စာရင်း/i.test(
      message,
    ) || hasPaymentMethodReference(message);

  return ((mentionsAppointment && asksLedgerDetail) || asksLifecycleRoster || asksWhoIsComingToday || asksCustomerServiceRoster) && !asksFinance;
}

function isNamedCustomerPurchaseQuestion(message: string) {
  return (
    hasExplicitCustomerSearchIntent(message) &&
    /purchase|purchased|bought|buy|payment|payments|package|packages|ဝယ်/i.test(message)
  );
}

function isCustomerRelationshipOpportunityQuestion(message: string) {
  return /(?:bought|purchase|purchased|package|service|ဝယ်)[\s\S]{0,80}(?:never came|never visit|never visited|not used|unused|not started|never checked in|မလာသေး|မလာ|မသုံး|အသုံးမပြု|မစ)|(?:never came|never visit|never visited|not used|unused|not started|never checked in|မလာသေး|မလာ|မသုံး|အသုံးမပြု|မစ)[\s\S]{0,80}(?:bought|purchase|purchased|package|service|ဝယ်)|dormant package|active balance.*90|lapsed customer|returned after follow/i.test(
    message,
  );
}

function isOwnerDailyBriefQuestion(message: string) {
  return /daily\s+brief|daily\s+summary|morning\s+brief|owner\s+brief|business\s+brief|what\s+should\s+(?:i|we)\s+focus(?:\s+on)?\s+today|what\s+needs\s+attention|needs?\s+attention|focus\s+today|risks?\s+today|what\s+are\s+the\s+risks\s+today|opportunities\s+today|what\s+are\s+the\s+opportunities\s+today|what\s+should\s+we\s+do\s+next|what\s+to\s+do\s+next|next\s+actions?|what\s+should\s+the\s+owner\s+know|ဒီနေ့\s*ဘာလုပ်ရမလဲ|ဘာကို\s*focus\s*လုပ်ရမလဲ|ဒီနေ့\s*အရေးကြီးတာ/i.test(
    message,
  );
}

export function resolveAgent(params: {
  requestedAgent: GreatTimeRequestedAgentId | undefined;
  message: string;
}): { resolvedAgent: GreatTimeAgentId; autoMode: boolean; scores: Record<GreatTimeAgentId, number> } {
  if (params.requestedAgent && params.requestedAgent !== "auto") {
    return {
      resolvedAgent: params.requestedAgent,
      autoMode: false,
      scores: {
        finance: 0,
        customer_relationship: 0,
        business: 0,
        appointment: 0,
      },
    };
  }

  const scores = Object.fromEntries(
    AGENT_ORDER.map((agentId) => [agentId, scoreAgent(params.message, agentId)]),
  ) as Record<GreatTimeAgentId, number>;

  if (hasExplicitServiceSearchIntent(params.message)) {
    scores.business += 2;
  }

  if (hasPaymentMethodReference(params.message)) {
    scores.finance += 6;
  }

  if (isNamedCustomerPurchaseQuestion(params.message)) {
    scores.customer_relationship += 4;
  }

  if (isCustomerRelationshipOpportunityQuestion(params.message)) {
    scores.customer_relationship += 4;
  }

  if (isOperationsCountReconciliationQuestion(params.message)) {
    scores.business += 8;
  }

  if (isTreatmentDetailQuestion(params.message)) {
    scores.business += 8;
    scores.customer_relationship = Math.max(0, scores.customer_relationship - 3);
  } else if (isTreatmentRosterQuestion(params.message)) {
    scores.business += 6;
    scores.customer_relationship = Math.max(0, scores.customer_relationship - 2);
  }

  if (isAppointmentRosterQuestion(params.message)) {
    scores.appointment += 6;
  }

  if (isAppointmentLedgerQuestion(params.message)) {
    scores.appointment += 4;
  }

  if (isOwnerDailyBriefQuestion(params.message)) {
    scores.business += 4;
  }

  if (
    !hasExplicitServiceSearchIntent(params.message) &&
    (hasExplicitCustomerSearchIntent(params.message) || extractLikelyCustomerSearchText(params.message)) &&
    scores.finance === 0 &&
    scores.appointment === 0 &&
    scores.business === 0
  ) {
    scores.customer_relationship += 1;
  }

  const resolvedAgent = AGENT_ORDER.reduce<GreatTimeAgentId>((best, candidate) => {
    if (scores[candidate] > scores[best]) {
      return candidate;
    }

    return best;
  }, "business");

  return {
    resolvedAgent: scores[resolvedAgent] > 0 ? resolvedAgent : "business",
    autoMode: true,
    scores,
  };
}
