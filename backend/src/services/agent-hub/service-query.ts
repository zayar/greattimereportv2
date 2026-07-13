const ORDINAL_OR_PRONOUN = /\b(first|second|third|fourth|fifth|it|that|that service|this service|သူ|အဲ့ဒီ)\b/i;

const GENERIC_SERVICE_PROMPTS =
  /\b(all|top|best|worst|which|what|list|show services|services|declining|trend|ranking|rankings|overview|summary|count|total|bookings?|appointments?|customers?|therapists?|practitioners?)\b/i;

const SERVICE_NAME_TERMS =
  /\b(laser|facial|body|contour|contouring|hifu|ultraformer|botox|filler|meso|inject|thread|prp|skin|peel|hydra|glow|whitening|revlite|ipl|co2|hair removal|lhr|slim|fat|bikini|massage|treatment|therapy|package)\b/i;

function cleanupSearchText(value: string | undefined) {
  return (value ?? "")
    .trim()
    .replace(/^[#:\-\s]+/g, "")
    .replace(/[?.!]+$/g, "")
    .replace(/\b(?:doing|performing|this year|year to date|ytd|today|last 30 days|this week)\b/gi, "")
    .replace(/\b(?:most|best)$/gi, "")
    .trim();
}

function looksLikeNamedService(value: string, force = false) {
  const cleaned = cleanupSearchText(value);

  if (!cleaned || ORDINAL_OR_PRONOUN.test(cleaned)) {
    return false;
  }

  if (!force && GENERIC_SERVICE_PROMPTS.test(cleaned) && !SERVICE_NAME_TERMS.test(cleaned)) {
    return false;
  }

  const words = cleaned.split(/\s+/).filter(Boolean);
  const hasLetters = /[A-Za-z\u1000-\u109F]/.test(cleaned);

  return hasLetters && words.length <= 10 && cleaned.length <= 120 && (force || SERVICE_NAME_TERMS.test(cleaned));
}

export function extractExplicitServiceSearchText(message: string) {
  const normalized = message.trim();
  const service360Match = normalized.match(
    /^(?:can\s+you\s+)?(?:(?:give\s+me|show|open)?\s*)?service\s*360\s*(?:for|about|on)?\s+(.+)$/i,
  );
  const service360Search = cleanupSearchText(service360Match?.[1]);

  if (service360Search && looksLikeNamedService(service360Search, true)) {
    return service360Search;
  }

  const analyticalFollowUpMatch = normalized.match(
    /^(?:(?:which|what)\s+services?.*(?:bought\s+together|co-?purchase|used\s+together|cross-?sell)\s+(?:with|for)|(?:which|who)\s+(?:customers?|therapists?|practitioners?).*\b(?:used|use|bought|buy|handle|handles|perform|performs|did|do)\b\s+)(.+?)\s*(?:most|best)?$/i,
  );
  const analyticalFollowUpSearch = cleanupSearchText(analyticalFollowUpMatch?.[1]);

  if (analyticalFollowUpSearch && looksLikeNamedService(analyticalFollowUpSearch)) {
    return analyticalFollowUpSearch;
  }

  const trailingDetailMatch = normalized.match(
    /^(.+?)\s+(?:service\s+details?|details?|information|info|profile|overview)[?.!]?$/i,
  );
  const trailingDetailSearch = cleanupSearchText(trailingDetailMatch?.[1]);

  if (trailingDetailSearch && looksLikeNamedService(trailingDetailSearch)) {
    return trailingDetailSearch;
  }

  const directMatch = normalized.match(
    /^(?:can\s+you\s+)?(?:tell\s+me\s+about|what\s+do\s+we\s+know\s+about|show(?:\s+me)?\s+details?\s+(?:about|for)|details?\s+(?:about|for)|how\s+is|how\s+are)\s+(.+)$/i,
  );
  const directSearch = cleanupSearchText(directMatch?.[1]);

  return looksLikeNamedService(directSearch) ? directSearch : "";
}

export function hasExplicitServiceSearchIntent(message: string) {
  return Boolean(extractExplicitServiceSearchText(message));
}

export function isService360Question(message: string) {
  return Boolean(extractExplicitServiceSearchText(message));
}
