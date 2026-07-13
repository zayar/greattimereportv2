import { hasPaymentMethodReference } from "./payment-method-intent.js";
import { isTreatmentDetailQuestion } from "./treatment-detail-intent.js";

const ORDINAL_OR_PRONOUN =
  /\b(first|second|third|fourth|fifth|they|them|that customer|that service|that|her|him|it|သူ|အဲ့ဒီ)\b/i;

const GENERIC_NON_CUSTOMER_TERMS =
  /\b(all|today|yesterday|week|month|appointments?|bookings?|sales?|revenue|transactions?|payments?|payment\s+method|invoices?|services?|practitioners?|therapists?|packages?|customers?|members?|report|summary|list|count|total|trend|method|wallet|cash|bank|kbz|kpay|kpaye|kbzpay|kbz\s+pay|wavepay|wave|mmqr|qr|cbpay|ayapay|mpu|visa|mastercard)\b|ဘယ်လောက်|ဝင်လဲ|ဝင်|ငွေ|ပေးချေ|အသေးစိတ်|စာရင်း/i;

function cleanupSearchText(value: string | undefined) {
  return (value ?? "")
    .trim()
    .replace(/^[#:\-\s]+/g, "")
    .replace(/[?.!]+$/g, "")
    .trim();
}

function looksLikeNamedCustomer(value: string) {
  const cleaned = cleanupSearchText(value);

  if (!cleaned || ORDINAL_OR_PRONOUN.test(cleaned) || GENERIC_NON_CUSTOMER_TERMS.test(cleaned) || hasPaymentMethodReference(cleaned)) {
    return false;
  }

  const words = cleaned.split(/\s+/).filter(Boolean);
  const hasLetters = /[A-Za-z\u1000-\u109F]/.test(cleaned);

  return hasLetters && words.length <= 6 && cleaned.length <= 80;
}

export function extractExplicitCustomerSearchText(message: string) {
  if (isTreatmentDetailQuestion(message)) {
    return "";
  }

  const normalized = message.trim();
  const purchaseSubjectMatch =
    normalized.match(
      /^(?:can\s+you\s+)?(?:tell\s+me\s+)?(?:what|which)\s+(?:services?|packages?|items?)\s+(?:did\s+)?(.+?)\s+(?:purchase|purchased|buy|bought|ဝယ်)[?.!]?(?:\s+.*)?$/i,
    ) ??
    normalized.match(
      /^(?:can\s+you\s+)?(?:tell\s+me\s+)?(?:what|which)\s+(?:did|has|have)\s+(.+?)\s+(?:purchase|purchased|buy|bought|ဝယ်)[?.!]?(?:\s+.*)?$/i,
    ) ??
    normalized.match(
      /^(?:show|view|display|tell\s+me)\s+([A-Za-z\u1000-\u109F][A-Za-z\u1000-\u109F\s().-]{1,80}?)\s+(?:purchase|purchases|payment|payments|package|packages)\s*(?:history|details?|စာရင်း)?[?.!]?$/i,
    );
  const purchaseSubject = cleanupSearchText(purchaseSubjectMatch?.[1]);

  if (purchaseSubject && looksLikeNamedCustomer(purchaseSubject)) {
    return purchaseSubject;
  }

  const trailingDetailMatch = normalized.match(
    /^([A-Za-z\u1000-\u109F][A-Za-z\u1000-\u109F\s().-]{1,80}?)\s+(?:customer\s+details?|details?|information|info|profile|overview)[?.!]?$/i,
  );
  const trailingDetailSearch = cleanupSearchText(trailingDetailMatch?.[1]);

  if (trailingDetailSearch && looksLikeNamedCustomer(trailingDetailSearch)) {
    return trailingDetailSearch;
  }

  const directMatch = normalized.match(
    /^(?:can\s+you\s+)?(?:find|search|look\s+up|show(?:\s+me)?(?:\s+details?\s+(?:about|for))?|tell\s+me\s+about|details?\s+(?:about|for)|what\s+about|who\s+is|what\s+do\s+we\s+know\s+about)\s+(.+)$/i,
  );
  const directSearch = cleanupSearchText(directMatch?.[1]);

  if (directSearch && !ORDINAL_OR_PRONOUN.test(directSearch) && looksLikeNamedCustomer(directSearch)) {
    return directSearch;
  }

  const showMatch = normalized.match(/^(?:show|view|display)\s+(.+)$/i);
  const showSearch = cleanupSearchText(showMatch?.[1]);

  return looksLikeNamedCustomer(showSearch) ? showSearch : "";
}

export function extractLikelyCustomerSearchText(message: string) {
  if (isTreatmentDetailQuestion(message)) {
    return "";
  }

  const explicit = extractExplicitCustomerSearchText(message);

  if (explicit) {
    return explicit;
  }

  const cleaned = cleanupSearchText(message);
  return looksLikeNamedCustomer(cleaned) ? cleaned : "";
}

export function hasCustomerEntityReference(message: string) {
  return ORDINAL_OR_PRONOUN.test(message);
}

export function hasExplicitCustomerSearchIntent(message: string) {
  return Boolean(extractExplicitCustomerSearchText(message));
}

export function isCustomer360Question(message: string) {
  const searchText = extractExplicitCustomerSearchText(message);

  if (!searchText || !looksLikeNamedCustomer(searchText)) {
    return false;
  }

  return (
    /tell\s+me\s+about|show|details?\s+(?:about|for)|what\s+about|who\s+is|what\s+do\s+we\s+know\s+about/i.test(message) ||
    /(?:customer\s+details?|details?|information|info|profile|overview)[?.!]?$/i.test(message.trim())
  );
}
