type PaymentMethodAlias = {
  canonical: string;
  patterns: RegExp[];
  generic?: boolean;
};

const PAYMENT_METHOD_ALIASES: PaymentMethodAlias[] = [
  {
    canonical: "YOMA",
    patterns: [/\byoma(?:\s*(?:bank|pay))?\b/i, /ရိုးမ(?:\s*ဘဏ်)?/i],
  },
  {
    canonical: "KPAY",
    patterns: [
      /\bkbz\s*pay\b/i,
      /\bkbzpay\b/i,
      /\bk\s*pay(?:\s*e)?\b/i,
      /\bkpay(?:e)?\b/i,
      /\bkpaye\b/i,
      /ကေဘီဇက်\s*ပေး/i,
      /ကေပေး/i,
    ],
  },
  {
    canonical: "KBZ",
    patterns: [/\bkbz(?:\s*bank)?\b/i, /ကေဘီဇက်/i],
  },
  {
    canonical: "AYAPAY",
    patterns: [/\baya\s*pay\b/i, /\bayapay\b/i],
  },
  {
    canonical: "AYA",
    patterns: [/\baya(?:\s*bank)?\b/i, /အေးရာ/i, /ဧရာ/i],
  },
  {
    canonical: "CBPAY",
    patterns: [/\bcb\s*pay\b/i, /\bcbpay\b/i],
  },
  {
    canonical: "CB",
    patterns: [/\bcb(?:\s*bank)?\b/i],
  },
  {
    canonical: "UAB",
    patterns: [/\buab(?:\s*bank)?\b/i],
  },
  {
    canonical: "MOB",
    patterns: [/\bmob(?:\s*bank)?\b/i],
  },
  {
    canonical: "WAVEPAY",
    patterns: [/\bwave\s*pay\b/i, /\bwavepay\b/i, /\bwave\b/i],
  },
  {
    canonical: "CASH",
    patterns: [/\bcash\b/i, /ငွေသား/i],
  },
  {
    canonical: "MMQR",
    patterns: [/\bmm\s*qr\b/i, /\bmyanmar\s*qr\b/i],
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
  {
    canonical: "BANK",
    patterns: [/\bbank(?:\s+transfer)?\b/i, /ဘဏ်/i],
    generic: true,
  },
];

const PAYMENT_METHOD_CONTEXT_PATTERN =
  /\b(?:payment|payments|method|transaction|transactions|transcription|transcriptions|detail|details|invoice|invoices|customer|service|amount|total|how\s+much|collect(?:ed|ion)?|received|income|rows?|list|bank|cash|wallet)\b|ဘယ်လောက်|ဝင်လဲ|ဝင်|ရလဲ|ငွေ|ကျပ်|ပေးချေ|ဘဏ်|ငွေသား|အသေးစိတ်|စာရင်း|ဘောက်ချာ|ဘယ်သူ|ဘာ\s*service|ပြပါ/i;

const QR_PATTERN = /\bqr\b/i;

const PAYMENT_METHOD_DETAIL_CUE_PATTERN =
  /\b(?:detail|details|transaction|transactions|transcription|transcriptions|invoice|invoice\s+number|customer|customer\s+name|service|service\s+name|list|rows?|show)\b|အသေးစိတ်|စာရင်း|ဘောက်ချာ|ဘယ်သူ|ဘာ\s*service|ပြပါ/i;

const PAYMENT_METHOD_AMOUNT_CUE_PATTERN =
  /\b(?:how\s+much|collected|collection|received|payment|income|amount|total)\b|ဘယ်လောက်|ဝင်လဲ|ဝင်|ရလဲ|ငွေ|ကျပ်/i;

export const PAYMENT_METHOD_BREAKDOWN_CUE_PATTERN =
  /\b(?:by\s+payment\s+method|payment\s+method\s+(?:breakdown|summary|report)|by\s+method|by\s+bank)\b|နည်းလမ်း\s*အလိုက်|method\s*အလိုက်|bank\s*အလိုက်|ဘဏ်\s*အလိုက်|အလိုက်/i;

function extractPaymentMethodAlias(message: string, includeGeneric: boolean) {
  for (const alias of PAYMENT_METHOD_ALIASES) {
    if (Boolean(alias.generic) !== includeGeneric) {
      continue;
    }
    if (alias.patterns.some((pattern) => pattern.test(message))) {
      return alias.canonical;
    }
  }

  return null;
}

export function extractSpecificPaymentMethodFilter(message: string): string | null {
  const alias = extractPaymentMethodAlias(message, false);
  if (alias) {
    return alias;
  }

  if (QR_PATTERN.test(message) && PAYMENT_METHOD_CONTEXT_PATTERN.test(message)) {
    return "MMQR";
  }

  return null;
}

export function extractGenericPaymentMethodFilter(message: string): string | null {
  return extractPaymentMethodAlias(message, true);
}

export function extractPaymentMethodFilter(message: string): string | null {
  return extractSpecificPaymentMethodFilter(message) ?? extractGenericPaymentMethodFilter(message);
}

export function normalizeMethodText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u1000-\u109f]/g, "");
}

function methodTokens(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u1000-\u109f]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function matchPaymentMethodFromAvailableMethods(
  message: string,
  availableMethods: Array<string | null | undefined> = [],
): string | null {
  const normalizedMessage = normalizeMethodText(message);
  const tokens = new Set(methodTokens(message));
  const methods = availableMethods
    .map((method) => (method ?? "").trim())
    .filter(Boolean)
    .sort((left, right) => normalizeMethodText(right).length - normalizeMethodText(left).length);

  for (const method of methods) {
    const normalizedMethod = normalizeMethodText(method);
    if (!normalizedMethod) {
      continue;
    }

    if (normalizedMethod.length <= 3) {
      if (tokens.has(normalizedMethod)) {
        return method;
      }
      continue;
    }

    if (normalizedMessage.includes(normalizedMethod)) {
      return method;
    }
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
