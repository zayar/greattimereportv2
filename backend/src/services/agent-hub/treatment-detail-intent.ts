import { hasPaymentMethodReference } from "./payment-method-intent.js";

export type TreatmentDetailFilters = {
  serviceName?: string;
  practitionerName?: string;
  wantsCustomerRows: boolean;
  wantsServiceBreakdown: boolean;
  wantsPractitionerBreakdown: boolean;
};

const PERIOD_CUE_PATTERN =
  /\b(?:today|yesterday|last\s+(?:day|week|month)|previous\s+month|this\s+(?:week|month)|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b|မနေ့က|မနေ့|ဒီနေ့|ယနေ့|ပြီးခဲ့တဲ့|ပြီးခဲ့သည့်|ယခင်/i;

const HISTORICAL_OR_COMPLETED_CUE_PATTERN =
  /\b(?:yesterday|last\s+(?:day|week|month)|previous\s+month|done|completed|finished)\b|မနေ့က|မနေ့|ပြီးခဲ့တဲ့|ပြီးခဲ့သည့်|ယခင်|ပြီး/i;

const TREATMENT_CONTEXT_PATTERN =
  /\b(?:service|services|treatment|treatments|therapist|therapists|practitioner|practitioners|doctor|staff|customer|customers|client|clients)\b|ဝန်ဆောင်မှု|ကုသ|ကုသမှု|ဆရာဝန်|ဘယ်သူ|ဘယ်\s*customer|ဘယ်\s*service|ဘယ်\s*therapist|ဘာ\s*service|လာလုပ်|လုပ်လဲ|တွေလုပ်လဲ|လုပ်ခဲ့|အသေးစိတ်|စာရင်း/i;

const ROW_DETAIL_CUE_PATTERN =
  /\b(?:who|which|customer|customers|client|clients|detail|details|list|rows?|show|did|came|served|performed|service\s+details?|therapist\s+details?)\b|ဘယ်သူ|ဘယ်သူတွေ|ဘယ်\s*customer|ဘယ်\s*service|ဘယ်\s*therapist|ဘာ\s*service|လာလုပ်|လုပ်လဲ|တွေလုပ်လဲ|လုပ်ခဲ့|အသေးစိတ်|စာရင်း|ပြပါ/i;

const APPOINTMENT_ONLY_PATTERN = /\b(?:appointment|appointments|booking|bookings|schedule)\b|ချိန်း|ဘိုကင်/i;

const APPOINTMENT_LIFECYCLE_PATTERN =
  /\b(?:arrived|checked\s*in|check-?in|checked\s*out|check-?out|checkout|not\s+started|not\s+finished|waiting|in\s+progress)\b|ရောက်ပြီး|မစသေး|မပြီးသေး|checkout|check\s*in|check\s*out/i;

const AGGREGATE_PERFORMANCE_PATTERN =
  /\b(?:performance|report|summary|overview|top|most|ranking|rank|count|total|trend|အများဆုံး|စုစုပေါင်း)\b|အများဆုံး|စုစုပေါင်း/i;

const ROLE_PATTERN = /\b(?:therapist|therapists|practitioner|practitioners|doctor|staff)\b|ဆရာဝန်/i;

const GENERIC_FILTER_TERM_PATTERN =
  /^(?:all|service|services|treatment|treatments|therapist|therapists|practitioner|practitioners|customer|customers|client|clients|detail|details|list|rows?|show|who|which|what|did|doing|came|served|performed|are|is|was|were|with|for|by|to|from|about|top|most|performance|summary|report|ranking|rank|sale|sales|amount|total|ဘယ်သူ|ဘယ်သူတွေ|ဘယ်|ဘာ|အသေးစိတ်|စာရင်း|ပြပါ|လုပ်လဲ|တွေလုပ်လဲ|လာလုပ်|လာလဲ|ဘယ်လောက်|ဘယ်လောက်လဲ|အများဆုံး|စုစုပေါင်း)$/i;

function normalizeSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeServiceSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u1000-\u109f]+/g, "")
    .trim();
}

export function cleanTreatmentServiceCandidate(value: string | undefined) {
  let cleaned = normalizeSpaces(value ?? "")
    .replace(/^[#:"'“”‘’\-–—\s]+/g, "")
    .replace(/[?!.။၊]+$/g, "")
    .trim();

  cleaned = cleaned
    .replace(/\b(?:please|can\s+you|could\s+you)\b/gi, " ")
    .replace(/\b(?:i\s+want\s+to\s+know|how\s+much|about)\b/gi, " ")
    .replace(/\b(?:tell\s+me|show\s+me|show|give\s+me|list|view|display)\b/gi, " ")
    .replace(/\b(?:today|yesterday|last\s+(?:day|week|month)|previous\s+month|this\s+(?:week|month))\b/gi, " ")
    .replace(/မနေ့က|မနေ့|ဒီနေ့|ယနေ့|ပြီးခဲ့တဲ့|ပြီးခဲ့သည့်|ယခင်/g, " ")
    .replace(/\bwho\s+did\b/gi, " ")
    .replace(/\b(?:who|which|what|did|doing|witch|came|served|performed|are|is|was|were|with|for|by|to|from)\b/gi, " ")
    .replace(/\b(?:customers?|clients?|details?|rows?|list|show)\b/gi, " ")
    .replace(/\b(?:top|most|performance|summary|report|ranking|rank|sales?|amount|total)\b/gi, " ")
    .replace(/\bservice\s*(?:ကို)?\b/gi, " ")
    .replace(/ဘယ်သူတွေ|ဘယ်သူ|ဘယ်\s*customer|ဘယ်\s*service|ဘယ်\s*therapist|ဘာ\s*service/g, " ")
    .replace(/နဲ့လုပ်ပြီး|နဲ့လုပ်လဲ|တွေလုပ်လဲ|လုပ်လဲ|လာလုပ်လဲ|လာလဲ|လုပ်ခဲ့|လုပ်ထား|လုပ်ပြီး|ပြပါ|အသေးစိတ်|စာရင်း|ဘယ်လောက်လဲ|ဘယ်လောက်|အများဆုံး|စုစုပေါင်း/g, " ")
    .replace(/(?:^|\s)(?:ဘယ်|ဘာ)(?=\s|$)/g, " ")
    .replace(/(?:^|\s)(?:ကို|က|မှာ|နဲ့|တွေ)(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
}

function hasTreatmentDetailCue(message: string) {
  return ROW_DETAIL_CUE_PATTERN.test(message);
}

function candidateWords(value: string) {
  return value.split(/\s+/).filter(Boolean);
}

function looksLikeNamedService(value: string) {
  const cleaned = cleanTreatmentServiceCandidate(value);

  if (!cleaned || GENERIC_FILTER_TERM_PATTERN.test(cleaned)) {
    return false;
  }

  const words = candidateWords(cleaned);
  const hasLetters = /[A-Za-z\u1000-\u109F]/.test(cleaned);

  return hasLetters && words.length <= 8 && cleaned.length <= 100;
}

function looksLikeNamedPractitioner(value: string) {
  const cleaned = cleanTreatmentServiceCandidate(value);

  if (
    !cleaned ||
    GENERIC_FILTER_TERM_PATTERN.test(cleaned) ||
    /\b(?:performance|report|summary|overview|ranking|trend|detail|details|list|rows?)\b/i.test(cleaned)
  ) {
    return false;
  }

  const words = candidateWords(cleaned);
  const hasLetters = /[A-Za-z\u1000-\u109F]/.test(cleaned);

  return hasLetters && words.length <= 5 && cleaned.length <= 80;
}

function extractServiceFromPattern(message: string) {
  const normalized = normalizeSpaces(message);
  const patterns = [
    /^(?:today|yesterday|last\s+(?:day|week|month)|previous\s+month|this\s+(?:week|month)|မနေ့က|မနေ့|ဒီနေ့|ယနေ့)\s+(.+?)\s+(?:ဘယ်သူ|ဘယ်သူတွေ|ဘယ်\s*customer|လာလုပ်|လုပ်လဲ|တွေလုပ်လဲ|လုပ်ခဲ့|အသေးစိတ်|စာရင်း|ပြပါ|customers?|clients?|details?|list|rows?|who|did|came|served|performed)/i,
    /(?:who\s+did|which\s+customers?\s+did|customers?\s+for)\s+(.+?)(?:\s+(?:today|yesterday|last\s+(?:day|week|month)|previous\s+month|this\s+(?:week|month))|[?.!]|$)/i,
    /(?:service|treatment)\s+(?:named|called|name)?\s*["']?(.+?)["']?\s+(?:who|which|customer|customers|detail|details|list|rows?|did|came|served|performed|ဘယ်သူ|လာလုပ်|လုပ်လဲ|အသေးစိတ်|စာရင်း|ပြပါ)/i,
  ];

  for (const pattern of patterns) {
    const candidate = cleanTreatmentServiceCandidate(normalized.match(pattern)?.[1]);
    if (looksLikeNamedService(candidate)) {
      return candidate;
    }
  }

  return "";
}

export function extractTreatmentServiceCandidate(message: string) {
  if (!hasTreatmentDetailCue(message)) {
    return "";
  }

  if (
    extractNamedPractitioner(message) &&
    /(?:what|which|ဘာ)\s*service|services?[\s\S]{0,40}(?:did|performed|လုပ်)/i.test(message)
  ) {
    return "";
  }

  const patterned = extractServiceFromPattern(message);
  if (patterned) {
    return patterned;
  }

  if (PERIOD_CUE_PATTERN.test(message) && TREATMENT_CONTEXT_PATTERN.test(message)) {
    const cleaned = cleanTreatmentServiceCandidate(message);
    return looksLikeNamedService(cleaned) ? cleaned : "";
  }

  return "";
}

function extractNamedPractitioner(message: string) {
  const normalized = normalizeSpaces(message);
  const beforeRole = normalized.match(
    /^(?:(?:today|yesterday|last\s+(?:day|week|month)|previous\s+month|this\s+(?:week|month)|မနေ့က|မနေ့|ဒီနေ့|ယနေ့)\s+)?(.+?)\s+(?:therapist|practitioner|doctor|staff|ဆရာဝန်)/i,
  );
  const beforeRoleCandidate = cleanTreatmentServiceCandidate(beforeRole?.[1]);

  if (looksLikeNamedPractitioner(beforeRoleCandidate)) {
    return beforeRoleCandidate;
  }

  const afterRole = normalized.match(
    /(?:therapist|practitioner|doctor|staff|ဆရာဝန်)\s+(?:named\s+|name\s+)?(.+?)(?:\s+(?:what|which|service|services|detail|details|list|rows?|did|လုပ်|ဘာ\s*service|အသေးစိတ်|စာရင်း|ပြပါ)|$)/i,
  );
  const afterRoleCandidate = cleanTreatmentServiceCandidate(afterRole?.[1]);

  return looksLikeNamedPractitioner(afterRoleCandidate) ? afterRoleCandidate : "";
}

export function extractTreatmentDetailFilters(message: string): TreatmentDetailFilters {
  const serviceName = extractTreatmentServiceCandidate(message);
  const practitionerName = extractNamedPractitioner(message);
  const wantsCustomerRows = ROW_DETAIL_CUE_PATTERN.test(message);
  const wantsServiceBreakdown = /service|services|ဘာ\s*service|ဝန်ဆောင်မှု/i.test(message) || Boolean(practitionerName);
  const wantsPractitionerBreakdown = ROLE_PATTERN.test(message) || Boolean(serviceName);

  return {
    serviceName: serviceName || undefined,
    practitionerName: practitionerName || undefined,
    wantsCustomerRows,
    wantsServiceBreakdown,
    wantsPractitionerBreakdown,
  };
}

export function hasNamedServiceInTreatmentQuestion(message: string): boolean {
  return Boolean(extractTreatmentDetailFilters(message).serviceName);
}

export function hasNamedPractitionerInTreatmentQuestion(message: string): boolean {
  return Boolean(extractTreatmentDetailFilters(message).practitionerName);
}

export function isTreatmentDetailQuestion(message: string): boolean {
  if (hasPaymentMethodReference(message) || APPOINTMENT_LIFECYCLE_PATTERN.test(message)) {
    return false;
  }

  if (APPOINTMENT_ONLY_PATTERN.test(message) && !/\b(?:daily\s+treatment|treatment\s+records?|service\/treatment)\b|ကုသမှု/i.test(message)) {
    return false;
  }

  const filters = extractTreatmentDetailFilters(message);
  const hasNamedFilter = Boolean(filters.serviceName || filters.practitionerName);
  const hasPeriodCue = PERIOD_CUE_PATTERN.test(message);
  const hasHistoricalOrCompletedCue = HISTORICAL_OR_COMPLETED_CUE_PATTERN.test(message);
  const hasTreatmentContext = TREATMENT_CONTEXT_PATTERN.test(message);
  const hasRowDetailCue = ROW_DETAIL_CUE_PATTERN.test(message);

  if (AGGREGATE_PERFORMANCE_PATTERN.test(message) && !hasNamedFilter && !/details?|list|rows?|customer|customers|who|ဘယ်သူ|အသေးစိတ်|စာရင်း/i.test(message)) {
    return false;
  }

  if (hasNamedFilter && (hasRowDetailCue || hasHistoricalOrCompletedCue)) {
    return true;
  }

  return hasHistoricalOrCompletedCue && hasPeriodCue && hasTreatmentContext && hasRowDetailCue;
}
