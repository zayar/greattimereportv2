import { extractExplicitCustomerSearchText, extractLikelyCustomerSearchText } from "../agent-hub/customer-query.js";
import { normalizeCustomerNameKey, normalizePhoneDigits } from "../agent-hub/customer-identity.js";
import type { GreatTimeAgentEntityContext } from "../agent-hub/types.js";

export type RecentAppointmentContextItem = {
  displayIndex: number;
  appointmentId: string;
  customerId: string;
  customerName: string;
  fullPhone?: string;
  resolutionPhone?: string;
  maskedPhone: string;
  memberId?: string;
  serviceName: string;
  staffName: string;
  appointmentTime: string;
  appointmentStatus: string;
};

export type RecentAppointmentContext = {
  clinicId: string;
  clinicCode: string;
  telegramChatId: string;
  telegramUserId: string | null;
  createdAt: number;
  expiresAt: number;
  appointments: RecentAppointmentContextItem[];
};

export type RecentAppointmentResolution =
  | { status: "resolved"; item: RecentAppointmentContextItem; action: "details" | "history" | "phone" }
  | { status: "suggestion"; query: string; item: RecentAppointmentContextItem }
  | { status: "ambiguous"; query: string; items: RecentAppointmentContextItem[] }
  | { status: "none" };

const RECENT_APPOINTMENT_CONTEXT_TTL_MS = 15 * 60_000;
const contexts = new Map<string, RecentAppointmentContext>();

function contextKey(params: { clinicId: string; telegramChatId: string; telegramUserId: string | null }) {
  return [params.clinicId, params.telegramChatId, params.telegramUserId ?? "chat"].join("|");
}

function cleanupRecentAppointmentContexts(now = Date.now()) {
  contexts.forEach((context, key) => {
    if (context.expiresAt <= now) {
      contexts.delete(key);
    }
  });
}

export function saveRecentAppointmentContext(params: {
  clinicId: string;
  clinicCode: string;
  telegramChatId: string;
  telegramUserId: string | null;
  appointments: RecentAppointmentContextItem[];
  now?: number;
}) {
  cleanupRecentAppointmentContexts(params.now);

  if (params.appointments.length === 0) {
    contexts.delete(contextKey(params));
    return null;
  }

  const createdAt = params.now ?? Date.now();
  const context: RecentAppointmentContext = {
    clinicId: params.clinicId,
    clinicCode: params.clinicCode,
    telegramChatId: params.telegramChatId,
    telegramUserId: params.telegramUserId,
    createdAt,
    expiresAt: createdAt + RECENT_APPOINTMENT_CONTEXT_TTL_MS,
    appointments: params.appointments,
  };
  contexts.set(contextKey(params), context);
  return context;
}

export function getRecentAppointmentContext(params: {
  clinicId: string;
  telegramChatId: string;
  telegramUserId: string | null;
  now?: number;
}) {
  cleanupRecentAppointmentContexts(params.now);
  return contexts.get(contextKey(params)) ?? null;
}

function parseOrdinalIndex(message: string) {
  const normalized = message.trim().toLowerCase();
  const ordinal = (
    [
      [/\bfirst\b|ပထမ/, 1],
      [/\bsecond\b|ဒုတိယ/, 2],
      [/\bthird\b|တတိယ/, 3],
      [/\bfourth\b/, 4],
      [/\bfifth\b/, 5],
      [/\bsixth\b/, 6],
      [/\bseventh\b/, 7],
      [/\beighth\b/, 8],
      [/\bninth\b/, 9],
      [/\btenth\b/, 10],
    ] as Array<[RegExp, number]>
  ).find(([pattern]) => pattern.test(normalized))?.[1];

  if (ordinal) {
    return ordinal;
  }

  const numberMatch =
    normalized.match(/^(?:#\s*)?(\d{1,2})$/) ??
    normalized.match(/\b(?:customer|appointment|details?|detail|history|phone|ဖုန်း)\s*#?\s*(\d{1,2})\b/) ??
    normalized.match(/\b(\d{1,2})\s*(?:customer|appointment|details?|detail|history|phone|ဖုန်း)\b/);

  return numberMatch?.[1] ? Number(numberMatch[1]) : null;
}

function actionFromMessage(message: string): "details" | "history" | "phone" {
  if (/\bphone\b|ဖုန်း/i.test(message)) {
    return "phone";
  }

  if (/history|treatments?|appointments?|purchase|payment|package|မှတ်တမ်း/i.test(message)) {
    return "history";
  }

  return "details";
}

function nameQueryFromMessage(message: string) {
  return extractExplicitCustomerSearchText(message) || extractLikelyCustomerSearchText(message);
}

function editDistance(left: string, right: string) {
  const a = [...left];
  const b = [...right];
  const dp = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) {
    dp[i]![0] = i;
  }
  for (let j = 0; j <= b.length; j += 1) {
    dp[0]![j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }

  return dp[a.length]![b.length]!;
}

function fuzzyNameScore(query: string, candidateName: string) {
  const queryKey = normalizeCustomerNameKey(query);
  const nameKey = normalizeCustomerNameKey(candidateName);
  if (!queryKey || !nameKey) {
    return 0;
  }
  if (queryKey === nameKey) {
    return 1;
  }
  if (nameKey.includes(queryKey) || queryKey.includes(nameKey)) {
    return 0.96;
  }

  const queryTokens = queryKey.split(/\s+/).filter(Boolean);
  const nameTokens = nameKey.split(/\s+/).filter(Boolean);
  const sharedTokens = queryTokens.filter((token) => nameTokens.includes(token)).length;
  const sharedRatio = sharedTokens / Math.max(queryTokens.length, nameTokens.length, 1);
  const distance = editDistance(queryKey, nameKey);
  const distanceScore = 1 - distance / Math.max(queryKey.length, nameKey.length, 1);

  return Math.max(distanceScore, sharedRatio);
}

function uniqueByCustomerId(items: RecentAppointmentContextItem[]) {
  const seen = new Set<string>();
  const unique: RecentAppointmentContextItem[] = [];

  items.forEach((item) => {
    if (!seen.has(item.customerId)) {
      seen.add(item.customerId);
      unique.push(item);
    }
  });

  return unique;
}

export function resolveRecentAppointmentReference(params: {
  message: string;
  context: RecentAppointmentContext | null;
}): RecentAppointmentResolution {
  if (!params.context?.appointments.length) {
    return { status: "none" };
  }

  const index = parseOrdinalIndex(params.message);
  if (index != null) {
    const item = params.context.appointments.find((appointment) => appointment.displayIndex === index);
    return item ? { status: "resolved", item, action: actionFromMessage(params.message) } : { status: "none" };
  }

  const query = nameQueryFromMessage(params.message).trim();
  if (!query) {
    return { status: "none" };
  }

  const queryName = normalizeCustomerNameKey(query);
  const queryDigits = normalizePhoneDigits(query);
  const exactMatches = uniqueByCustomerId(
    params.context.appointments.filter((item) => {
      const name = normalizeCustomerNameKey(item.customerName);
      const fullPhoneDigits = normalizePhoneDigits(item.resolutionPhone ?? item.fullPhone);
      const maskedPhoneDigits = normalizePhoneDigits(item.maskedPhone);
      const memberId = normalizeCustomerNameKey(item.memberId);

      return (
        (queryName && name === queryName) ||
        (queryName && name.includes(queryName)) ||
        (queryDigits && fullPhoneDigits && fullPhoneDigits.includes(queryDigits)) ||
        (queryDigits && maskedPhoneDigits && maskedPhoneDigits.includes(queryDigits)) ||
        (queryName && memberId && memberId === queryName)
      );
    }),
  );

  if (exactMatches.length === 1) {
    return { status: "resolved", item: exactMatches[0]!, action: actionFromMessage(params.message) };
  }
  if (exactMatches.length > 1) {
    return { status: "ambiguous", query, items: exactMatches };
  }

  const scored = params.context.appointments
    .map((item) => ({ item, score: fuzzyNameScore(query, item.customerName) }))
    .sort((left, right) => right.score - left.score);
  const best = scored[0];
  const runnerUp = scored[1];

  if (best && best.score >= 0.72 && (!runnerUp || best.score - runnerUp.score >= 0.08)) {
    return { status: "suggestion", query, item: best.item };
  }

  return { status: "none" };
}

export function appointmentContextItemToCustomerEntityContext(
  item: RecentAppointmentContextItem,
): GreatTimeAgentEntityContext {
  return {
    entityType: "customer",
    entityId: item.customerId,
    customerKey: item.customerId,
    displayName: item.customerName,
    customerName: item.customerName,
    customerPhone: item.resolutionPhone ?? item.fullPhone,
    customerPhoneMasked: item.maskedPhone,
    memberId: item.memberId,
    appointmentId: item.appointmentId,
    appointmentTime: item.appointmentTime,
    appointmentStatus: item.appointmentStatus,
    serviceName: item.serviceName,
    practitionerName: item.staffName,
    rank: item.displayIndex,
  };
}

export const __test = {
  clear() {
    contexts.clear();
  },
  size() {
    cleanupRecentAppointmentContexts();
    return contexts.size;
  },
};
