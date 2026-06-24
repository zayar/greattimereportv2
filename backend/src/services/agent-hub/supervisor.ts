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
