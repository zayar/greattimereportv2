const TOP_CUSTOMER_REVENUE_PATTERNS = [
  /\b(?:top|best|biggest|vip)\s+(?:customers?|members?|clients?)\b/i,
  /\b(?:highest\s+(?:spending|value)|most\s+valuable)\s+(?:customers?|members?|clients?)\b/i,
  /\b(?:customers?|members?|clients?)\s+(?:who\s+)?(?:spent|spend|paid|pay|paying|bought|buy|purchased|purchase)\s+(?:the\s+)?most\b/i,
  /\btop\s+(?:spenders?|paying\s+customers?)\b/i,
  /(?:အများဆုံးသုံးတဲ့|ငွေအများဆုံးသုံးတဲ့|အများဆုံးဝယ်တဲ့)[\s\S]{0,30}(?:customers?|customer|members?|clients?|ဖောက်သည်)/i,
  /(?:အများဆုံး|ငွေအများဆုံး|spending\s*အများဆုံး|ဝင်ငွေအများဆုံး|ဈေးအများဆုံး)[\s\S]{0,40}(?:customers?|customer|members?|clients?|ဖောက်သည်)/i,
  /(?:customers?|customer|members?|clients?|ဖောက်သည်)[\s\S]{0,50}(?:အများဆုံး\s*(?:သုံး|ဝယ်|သုံးထား)|spending\s*အများဆုံး|ငွေအများဆုံး|ဝင်ငွေအများဆုံး|ဈေးအများဆုံး)/i,
];

const TOP_CUSTOMER_VISIT_PATTERNS = [
  /\b(?:customers?|members?|clients?)\s+(?:with\s+)?(?:the\s+)?(?:most|highest|top)\s+visits?\b/i,
  /\b(?:most|highest|top)\s+visits?\s+(?:customers?|members?|clients?)\b/i,
  /\btop\s+visit\s+(?:customers?|members?|clients?)\b/i,
  /(?:လာတာ|visit)\s*အများဆုံး[\s\S]{0,40}(?:customers?|customer|members?|clients?|ဖောက်သည်)/i,
  /(?:customers?|customer|members?|clients?|ဖောက်သည်)[\s\S]{0,40}(?:လာတာ|visit)\s*အများဆုံး/i,
];

export function isTopCustomerByRevenueQuestion(message: string) {
  return TOP_CUSTOMER_REVENUE_PATTERNS.some((pattern) => pattern.test(message));
}

export function isTopCustomerByVisitsQuestion(message: string) {
  return TOP_CUSTOMER_VISIT_PATTERNS.some((pattern) => pattern.test(message));
}

export function isTopCustomerQuestion(message: string) {
  return isTopCustomerByRevenueQuestion(message) || isTopCustomerByVisitsQuestion(message);
}
