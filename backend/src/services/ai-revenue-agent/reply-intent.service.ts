export type AiRevenueReplyIntent =
  | "interested"
  | "wants_appointment"
  | "selected_time"
  | "confirm"
  | "price_question"
  | "call_request"
  | "not_interested"
  | "cancel"
  | "reschedule"
  | "complaint"
  | "unclear";

type Classification = {
  intent: AiRevenueReplyIntent;
  confidence: number;
};

function normalizedText(value: string) {
  return value.trim().toLowerCase();
}

function hasAny(text: string, patterns: Array<string | RegExp>) {
  return patterns.some((pattern) => {
    if (typeof pattern === "string") {
      return text.includes(pattern);
    }

    return pattern.test(text);
  });
}

export function classifyAiRevenueReply(replyText: string): Classification {
  const text = normalizedText(replyText);

  if (!text) {
    return { intent: "unclear", confidence: 0.2 };
  }

  if (hasAny(text, ["angry", "complaint", "complain", "bad service", "unhappy", "စိတ်ဆိုး", "မကျေနပ်", "တိုင်"])) {
    return { intent: "complaint", confidence: 0.86 };
  }

  if (hasAny(text, [/\bnot interested\b/, "မလို", /\bno\b/, "မလုပ်"])) {
    return { intent: "not_interested", confidence: 0.84 };
  }

  if (hasAny(text, [/\bcancel\b/, "ဖျက်"])) {
    return { intent: "cancel", confidence: 0.84 };
  }

  if (hasAny(text, [/\breschedule\b/, "ချိန်းပြောင်း", "ရက်ပြောင်း", "အချိန်ပြောင်း"])) {
    return { intent: "reschedule", confidence: 0.84 };
  }

  if (hasAny(text, [/\bprice\b/, /\bhow much\b/, "ဘယ်လောက်", "ဈေး", "စျေး"])) {
    return { intent: "price_question", confidence: 0.82 };
  }

  if (hasAny(text, [/\bcall me\b/, "ဖုန်းဆက်", "ဆက်သွယ်"])) {
    return { intent: "call_request", confidence: 0.82 };
  }

  if (
    hasAny(text, [
      /\b\d{1,2}\s?(?:am|pm)\b/,
      /\b\d{1,2}:\d{2}\b/,
      /နေ့လည်\s*[၂2]/,
      /မနက်\s*[၀-၉0-9]+/,
      /ညနေ\s*[၀-၉0-9]+/,
    ])
  ) {
    return { intent: "selected_time", confidence: 0.82 };
  }

  if (hasAny(text, [/\btomorrow\b/, "မနက်ဖြန်"])) {
    return { intent: "wants_appointment", confidence: 0.78 };
  }

  if (hasAny(text, [/\bconfirm\b/, "လာမယ်"])) {
    return { intent: "confirm", confidence: 0.8 };
  }

  if (hasAny(text, [/\bok\b/, /\byes\b/, /\bbook\b/, "အိုကေ", "ဟုတ်", "ရပါတယ်"])) {
    return { intent: "interested", confidence: 0.76 };
  }

  return { intent: "unclear", confidence: 0.35 };
}
