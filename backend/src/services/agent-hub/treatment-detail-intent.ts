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
  /\b(?:service|services|treatment|treatments|therapist|therapists|practitioner|practitioners|doctor|staff|customer|customers|client|clients)\b|ဝန်ဆောင်မှု|ကုသ|ကုသမှု|ဆရာဝန်|ဘယ်သူ|ဘယ်\s*customer|ဘယ်\s*service|ဘယ်\s*therapist|ဘာ\s*service|လာလုပ်|လုပ်လဲ|လုပ်ခဲ့|အသေးစိတ်|စာရင်း/i;

const ROW_DETAIL_CUE_PATTERN =
  /\b(?:who|which|customer|customers|client|clients|detail|details|list|rows?|show|did|came|served|performed|service\s+details?|therapist\s+details?)\b|ဘယ်သူ|ဘယ်\s*customer|ဘယ်\s*service|ဘယ်\s*therapist|ဘာ\s*service|လာလုပ်|လုပ်လဲ|လုပ်ခဲ့|အသေးစိတ်|စာရင်း|ပြပါ/i;

const APPOINTMENT_ONLY_PATTERN = /\b(?:appointment|appointments|booking|bookings|schedule)\b|ချိန်း|ဘိုကင်/i;

const APPOINTMENT_LIFECYCLE_PATTERN =
  /\b(?:arrived|checked\s*in|check-?in|checked\s*out|check-?out|checkout|not\s+started|not\s+finished|waiting|in\s+progress)\b|ရောက်ပြီး|မစသေး|မပြီးသေး|checkout|check\s*in|check\s*out/i;

const AGGREGATE_PERFORMANCE_PATTERN =
  /\b(?:performance|report|summary|overview|top|most|ranking|rank|count|total|trend|အများဆုံး|စုစုပေါင်း)\b|အများဆုံး|စုစုပေါင်း/i;

const ROLE_PATTERN = /\b(?:therapist|therapists|practitioner|practitioners|doctor|staff)\b|ဆရာဝန်/i;

const SERVICE_NAME_HINT_PATTERN =
  /\b(?:laser|facial|body|contour|contouring|hifu|ultraformer|botox|filler|meso|inject|thread|prp|skin|peel|hydra|glow|whitening|revlite|ipl|co2|hair\s*removal|lhr|slim|fat|bikini|massage|treatment|therapy|package|wax|acne|scar|melasma|rf|ems|aqua|cleaning|lifting|removal)\b/i;

const GENERIC_FILTER_TERM_PATTERN =
  /^(?:all|today|yesterday|service|services|treatment|treatments|therapist|therapists|practitioner|practitioners|customer|customers|client|clients|detail|details|list|rows?|show|who|which|what|did|came|served|performed|မနေ့က|မနေ့|ဒီနေ့|ယနေ့|ဘယ်သူ|ဘယ်|ဘာ|အသေးစိတ်|စာရင်း|ပြပါ|လုပ်လဲ|လာလုပ်)$/i;

function normalizeSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function cleanupCandidate(value: string | undefined) {
  return normalizeSpaces(value ?? "")
    .replace(/^[#:"'“”‘’\-–—\s]+/g, "")
    .replace(/[?!.။၊]+$/g, "")
    .replace(
      /^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?(?:show|tell\s+me|give\s+me|list|view|display)\s+(?:me\s+)?/i,
      "",
    )
    .replace(
      /^(?:today|yesterday|last\s+(?:day|week|month)|previous\s+month|this\s+(?:week|month)|မနေ့က|မနေ့|ဒီနေ့|ယနေ့)\s+/i,
      "",
    )
    .replace(/^(?:ပြီးခဲ့တဲ့|ပြီးခဲ့သည့်|ယခင်)\s*/i, "")
    .replace(
      /\s*(?:who|which|customer|customers|client|clients|detail|details|list|rows?|show|did|came|served|performed|service\s+details?|therapist\s+details?|ဘယ်သူ|ဘယ်\s*customer|ဘယ်\s*service|ဘယ်\s*therapist|ဘာ\s*service|လာလုပ်|လုပ်လဲ|လုပ်ခဲ့|လုပ်ထား|အသေးစိတ်|စာရင်း|ပြပါ)[\s\S]*$/i,
      "",
    )
    .trim();
}

function candidateWords(value: string) {
  return value.split(/\s+/).filter(Boolean);
}

function looksLikeNamedService(value: string, sourceMessage: string) {
  const cleaned = cleanupCandidate(value);

  if (!cleaned || GENERIC_FILTER_TERM_PATTERN.test(cleaned)) {
    return false;
  }

  const words = candidateWords(cleaned);
  const hasLetters = /[A-Za-z\u1000-\u109F]/.test(cleaned);
  const followedByRole = new RegExp(`${escapeRegExp(cleaned)}\\s+(?:therapist|practitioner|doctor|staff)`, "i").test(sourceMessage);

  if (followedByRole && !SERVICE_NAME_HINT_PATTERN.test(cleaned)) {
    return false;
  }

  return hasLetters && words.length <= 8 && cleaned.length <= 100 && SERVICE_NAME_HINT_PATTERN.test(cleaned);
}

function looksLikeNamedPractitioner(value: string) {
  const cleaned = cleanupCandidate(value);

  if (
    !cleaned ||
    GENERIC_FILTER_TERM_PATTERN.test(cleaned) ||
    /\b(?:performance|report|summary|overview|ranking|trend|detail|details|list|rows?)\b/i.test(cleaned) ||
    SERVICE_NAME_HINT_PATTERN.test(cleaned)
  ) {
    return false;
  }

  const words = candidateWords(cleaned);
  const hasLetters = /[A-Za-z\u1000-\u109F]/.test(cleaned);

  return hasLetters && words.length <= 5 && cleaned.length <= 80;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractNamedService(message: string) {
  const normalized = normalizeSpaces(message);
  const directPatterns = [
    /^(?:(?:today|yesterday|last\s+(?:day|week|month)|previous\s+month|this\s+(?:week|month)|မနေ့က|မနေ့|ဒီနေ့|ယနေ့)\s+)?(.+?)\s+(?:who|which|customer|customers|client|clients|detail|details|list|rows?|did|came|served|performed|ဘယ်သူ|ဘယ်\s*customer|လာလုပ်|လုပ်လဲ|လုပ်ခဲ့|အသေးစိတ်|စာရင်း|ပြပါ)/i,
    /(?:service|treatment)\s+(?:named|called|name)?\s*["']?(.+?)["']?\s+(?:who|which|customer|customers|detail|details|list|rows?|did|came|served|performed|ဘယ်သူ|လာလုပ်|လုပ်လဲ|အသေးစိတ်|စာရင်း|ပြပါ)/i,
  ];

  for (const pattern of directPatterns) {
    const candidate = cleanupCandidate(normalized.match(pattern)?.[1]);
    if (looksLikeNamedService(candidate, normalized)) {
      return candidate;
    }
  }

  const fallback = cleanupCandidate(normalized);
  return looksLikeNamedService(fallback, normalized) && ROW_DETAIL_CUE_PATTERN.test(normalized) ? fallback : "";
}

function extractNamedPractitioner(message: string) {
  const normalized = normalizeSpaces(message);
  const beforeRole = normalized.match(
    /^(?:(?:today|yesterday|last\s+(?:day|week|month)|previous\s+month|this\s+(?:week|month)|မနေ့က|မနေ့|ဒီနေ့|ယနေ့)\s+)?(.+?)\s+(?:therapist|practitioner|doctor|staff|ဆရာဝန်)/i,
  );
  const beforeRoleCandidate = cleanupCandidate(beforeRole?.[1]);

  if (looksLikeNamedPractitioner(beforeRoleCandidate)) {
    return beforeRoleCandidate;
  }

  const afterRole = normalized.match(
    /(?:therapist|practitioner|doctor|staff|ဆရာဝန်)\s+(?:named\s+|name\s+)?(.+?)(?:\s+(?:what|which|service|services|detail|details|list|rows?|did|လုပ်|ဘာ\s*service|အသေးစိတ်|စာရင်း|ပြပါ)|$)/i,
  );
  const afterRoleCandidate = cleanupCandidate(afterRole?.[1]);

  return looksLikeNamedPractitioner(afterRoleCandidate) ? afterRoleCandidate : "";
}

export function extractTreatmentDetailFilters(message: string): TreatmentDetailFilters {
  const serviceName = extractNamedService(message);
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
