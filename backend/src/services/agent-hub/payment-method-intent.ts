type PaymentMethodAlias = {
  canonical: string;
  patterns: RegExp[];
};

const PAYMENT_METHOD_ALIASES: PaymentMethodAlias[] = [
  {
    canonical: "CASH",
    patterns: [/\bcash\b/i, /ငွေသား/i],
  },
  {
    canonical: "KPAY",
    patterns: [/\bk\s*pay(?:\s*e)?\b/i, /\bkpaye\b/i, /\bkbz\s*pay\b/i, /ကေပေး/i],
  },
  {
    canonical: "WAVEPAY",
    patterns: [/\bwave\s*pay\b/i, /\bwavepay\b/i, /\bwave\b/i],
  },
  {
    canonical: "MMQR",
    patterns: [/\bmm\s*qr\b/i, /\bmyanmar\s*qr\b/i],
  },
  {
    canonical: "BANK",
    patterns: [/\bbank(?:\s+transfer)?\b/i, /ဘဏ်/i],
  },
  {
    canonical: "CBPAY",
    patterns: [/\bcb\s*pay\b/i, /\bcbpay\b/i],
  },
  {
    canonical: "AYAPAY",
    patterns: [/\baya\s*pay\b/i, /\bayapay\b/i],
  },
  {
    canonical: "MPU",
    patterns: [/\bmpu\b/i],
  },
  {
    canonical: "VISA",
    patterns: [/\bvisa\b/i],
  },
  {
    canonical: "MASTERCARD",
    patterns: [/\bmaster\s*card\b/i, /\bmastercard\b/i],
  },
];

const PAYMENT_METHOD_CONTEXT_PATTERN =
  /\b(?:payment|payments|method|transaction|transactions|detail|details|invoice|invoices|customer|service|amount|total|how\s+much|collect(?:ed|ion)?|received|income|rows?|list|bank|cash|wallet)\b|ဘယ်လောက်|ဝင်လဲ|ဝင်|ရလဲ|ငွေ|ကျပ်|ပေးချေ|ဘဏ်|ငွေသား|အသေးစိတ်|စာရင်း|ဘောက်ချာ|ဘယ်သူ|ဘာ\s*service|ပြပါ/i;

const QR_PATTERN = /\bqr\b/i;

const PAYMENT_METHOD_DETAIL_CUE_PATTERN =
  /\b(?:detail|details|transaction|transactions|invoice|invoice\s+number|customer|customer\s+name|service|service\s+name|list|rows?|show)\b|အသေးစိတ်|စာရင်း|ဘောက်ချာ|ဘယ်သူ|ဘာ\s*service|ပြပါ/i;

const PAYMENT_METHOD_AMOUNT_CUE_PATTERN =
  /\b(?:how\s+much|collected|collection|received|payment|income|amount|total)\b|ဘယ်လောက်|ဝင်လဲ|ဝင်|ရလဲ|ငွေ|ကျပ်/i;

export const PAYMENT_METHOD_BREAKDOWN_CUE_PATTERN =
  /\b(?:by\s+payment\s+method|payment\s+method\s+(?:breakdown|summary|report)|by\s+method|by\s+bank)\b|နည်းလမ်း\s*အလိုက်|method\s*အလိုက်|bank\s*အလိုက်|ဘဏ်\s*အလိုက်|အလိုက်/i;

export function extractPaymentMethodFilter(message: string): string | null {
  for (const alias of PAYMENT_METHOD_ALIASES) {
    if (alias.patterns.some((pattern) => pattern.test(message))) {
      return alias.canonical;
    }
  }

  if (QR_PATTERN.test(message) && PAYMENT_METHOD_CONTEXT_PATTERN.test(message)) {
    return "MMQR";
  }

  return null;
}

export function hasPaymentMethodReference(message: string): boolean {
  return Boolean(extractPaymentMethodFilter(message));
}

export function isPaymentMethodBreakdownQuestion(message: string): boolean {
  return PAYMENT_METHOD_BREAKDOWN_CUE_PATTERN.test(message);
}

export function isPaymentMethodDetailQuestion(message: string): boolean {
  if (!hasPaymentMethodReference(message)) {
    return false;
  }

  if (isPaymentMethodBreakdownQuestion(message)) {
    return false;
  }

  return PAYMENT_METHOD_DETAIL_CUE_PATTERN.test(message) || PAYMENT_METHOD_AMOUNT_CUE_PATTERN.test(message);
}
