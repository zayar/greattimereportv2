import type { GreatTimeAgentId, GreatTimeRequestedAgentId } from "./types.js";
import { extractLikelyCustomerSearchText, hasExplicitCustomerSearchIntent } from "./customer-query.js";
import { hasExplicitServiceSearchIntent } from "./service-query.js";

const AGENT_ORDER: GreatTimeAgentId[] = ["finance", "customer_relationship", "business", "appointment"];

const KEYWORDS: Record<GreatTimeAgentId, RegExp[]> = {
  finance: [
    /sales?|revenue|invoice|payment|collection|collected|cash|bank|wallet|kpay|kbz|purchase|refund/i,
    /ရောင်း|ဝင်ငွေ|ငွေ|ပေးချေ|ဘဏ်|အကြွေး|ငွေသား/i,
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
    /appointment|booking|booked|arrival|arrived|check[- ]?in|checked in|check[- ]?out|checked out|waiting|no[- ]?show|cancel/i,
    /ချိန်း|ဘိုကင်|ရောက်|check in|check out|မလာ|ဖျက်/i,
  ],
};

function scoreAgent(message: string, agentId: GreatTimeAgentId) {
  return KEYWORDS[agentId].reduce((score, keyword) => score + (keyword.test(message) ? 1 : 0), 0);
}

function isAppointmentLedgerQuestion(message: string) {
  const mentionsAppointment = /appointment|appointments|booking|bookings|schedule|ချိန်း|ဘိုကင်/i.test(message);
  const asksLedgerDetail =
    /today|ဒီနေ့|who|what|which|list|show|all|customer|customers|member|members|service|services|therapist|therapists|practitioner|practitioners|ဘယ်သူ|ဝန်ဆောင်မှု|ဖောက်သည်/i.test(
      message,
    );
  const asksFinance = /sales?|revenue|payment|collection|collected|invoice|ငွေ|ရောင်း|ဝင်ငွေ/i.test(message);

  return mentionsAppointment && asksLedgerDetail && !asksFinance;
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

  if (isNamedCustomerPurchaseQuestion(params.message)) {
    scores.customer_relationship += 4;
  }

  if (isCustomerRelationshipOpportunityQuestion(params.message)) {
    scores.customer_relationship += 4;
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
