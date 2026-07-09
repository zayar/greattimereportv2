import {
  extractSpecificPaymentMethodFilter,
  matchPaymentMethodFromAvailableMethods,
  normalizeMethodText,
} from "../agent-hub/payment-method-intent.js";
import type { AgentPeriod } from "../agent-hub/types.js";

export type RecentPaymentMethodContextItem = {
  rank: number;
  paymentMethod: string;
  totalAmount: number;
  transactionCount: number;
};

export type RecentPaymentMethodContext = {
  clinicId: string;
  clinicCode: string;
  telegramChatId: string;
  telegramUserId: string | null;
  period: AgentPeriod;
  createdAt: number;
  expiresAt: number;
  methods: RecentPaymentMethodContextItem[];
};

export type RecentPaymentMethodResolution =
  | { status: "resolved"; item: RecentPaymentMethodContextItem; context: RecentPaymentMethodContext }
  | { status: "none" };

const RECENT_PAYMENT_METHOD_CONTEXT_TTL_MS = 30 * 60_000;
const contexts = new Map<string, RecentPaymentMethodContext>();

function contextKey(params: { clinicId: string; telegramChatId: string; telegramUserId: string | null }) {
  return [params.clinicId, params.telegramChatId, params.telegramUserId ?? "chat"].join("|");
}

function cleanupRecentPaymentMethodContexts(now = Date.now()) {
  contexts.forEach((context, key) => {
    if (context.expiresAt <= now) {
      contexts.delete(key);
    }
  });
}

export function saveRecentPaymentMethodContext(params: {
  clinicId: string;
  clinicCode: string;
  telegramChatId: string;
  telegramUserId: string | null;
  period: AgentPeriod;
  methods: RecentPaymentMethodContextItem[];
  now?: number;
}) {
  cleanupRecentPaymentMethodContexts(params.now);

  if (params.methods.length === 0) {
    contexts.delete(contextKey(params));
    return null;
  }

  const createdAt = params.now ?? Date.now();
  const context: RecentPaymentMethodContext = {
    clinicId: params.clinicId,
    clinicCode: params.clinicCode,
    telegramChatId: params.telegramChatId,
    telegramUserId: params.telegramUserId,
    period: params.period,
    createdAt,
    expiresAt: createdAt + RECENT_PAYMENT_METHOD_CONTEXT_TTL_MS,
    methods: params.methods,
  };
  contexts.set(contextKey(params), context);
  return context;
}

export function getRecentPaymentMethodContext(params: {
  clinicId: string;
  telegramChatId: string;
  telegramUserId: string | null;
  now?: number;
}) {
  cleanupRecentPaymentMethodContexts(params.now);
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
    normalized.match(/\b(?:method|payment|bank|details?|detail|transaction|transactions)\s*#?\s*(\d{1,2})\b/) ??
    normalized.match(/\b(\d{1,2})\s*(?:method|payment|bank|details?|detail|transaction|transactions)\b/) ??
    normalized.match(/နံပါတ်\s*(\d{1,2})/);

  return numberMatch?.[1] ? Number(numberMatch[1]) : null;
}

export function resolveRecentPaymentMethodReference(params: {
  message: string;
  context: RecentPaymentMethodContext | null;
}): RecentPaymentMethodResolution {
  if (!params.context?.methods.length) {
    return { status: "none" };
  }

  const methods = params.context.methods.map((method) => method.paymentMethod);
  const specificMethod =
    matchPaymentMethodFromAvailableMethods(params.message, methods) ??
    extractSpecificPaymentMethodFilter(params.message);
  if (specificMethod) {
    const normalizedSpecific = normalizeMethodText(specificMethod);
    const item = params.context.methods.find(
      (method) =>
        method.paymentMethod === specificMethod ||
        extractSpecificPaymentMethodFilter(method.paymentMethod) === specificMethod ||
        normalizeMethodText(method.paymentMethod) === normalizedSpecific,
    );
    if (item) {
      return { status: "resolved", item, context: params.context };
    }
  }

  const index = parseOrdinalIndex(params.message);
  if (index != null) {
    const item = params.context.methods.find((method) => method.rank === index);
    return item ? { status: "resolved", item, context: params.context } : { status: "none" };
  }

  return { status: "none" };
}

export const __test = {
  clear() {
    contexts.clear();
  },
  size() {
    cleanupRecentPaymentMethodContexts();
    return contexts.size;
  },
};
