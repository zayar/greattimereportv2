import {
  resolveCustomerPortalCandidates,
} from "../reports/customer-portal.service.js";
import {
  searchCustomerRelationshipProfilesBounded,
  type CustomerRelationshipProfileSearchInput,
} from "../reports/customer-relationship-profile.repository.js";
import { extractExplicitCustomerSearchText } from "./customer-query.js";
import { limitRows, maskPhone, nowIso } from "./safety.js";
import type {
  AgentDataStatus,
  AgentSourceScope,
  AgentToolInput,
  GreatTimeAgentSource,
  GreatTimeAgentWarning,
} from "./types.js";

export type ResolvedCustomerIdentity = {
  customerKey: string;
  customerName: string;
  customerPhone: string;
  phoneMasked: string;
  memberId?: string;
  joinedDate?: string | null;
  sourceScope: AgentSourceScope;
};

export type CandidateRow = {
  customerKey: string;
  customerName: string;
  phoneNumber?: string;
  phoneMasked?: string;
  memberId?: string | null;
  joinedDate?: string | null;
  lastVisitDate?: string | null;
  totalVisits?: number;
  lifetimeSpend?: number;
};

export type CustomerResolverResult =
  | { status: "resolved"; identity: ResolvedCustomerIdentity; sources: GreatTimeAgentSource[] }
  | { status: "ambiguous"; searchText: string; candidates: CandidateRow[]; sources: GreatTimeAgentSource[] }
  | { status: "suggestions"; searchText: string; candidates: CandidateRow[]; sources: GreatTimeAgentSource[]; warnings: GreatTimeAgentWarning[] }
  | { status: "no_history"; identity: ResolvedCustomerIdentity; sources: GreatTimeAgentSource[]; warnings: GreatTimeAgentWarning[] }
  | { status: "not_found" | "not_ready" | "unavailable"; searchText: string; sources: GreatTimeAgentSource[]; warnings: GreatTimeAgentWarning[] };

function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

function parseNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (value && typeof value === "object" && "value" in value) {
    return Number((value as { value: unknown }).value);
  }

  return Number(value ?? 0);
}

function source(params: {
  tool: string;
  sourceName: string;
  checkedAt?: string;
  period?: string;
  dataStatus: AgentDataStatus;
  scope: AgentSourceScope;
  live?: boolean;
}): GreatTimeAgentSource {
  return {
    tool: params.tool,
    sourceName: params.sourceName,
    checkedAt: params.checkedAt ?? nowIso(),
    period: params.period,
    dataStatus: params.dataStatus,
    live: params.live ?? params.scope === "live",
    scope: params.scope,
  };
}

function isExactCandidate(searchText: string, candidate: CandidateRow) {
  const search = normalizeText(searchText);
  const searchDigits = normalizeDigits(searchText);
  const phoneDigits = normalizeDigits(candidate.phoneNumber);

  return (
    (search && normalizeText(candidate.customerName) === search) ||
    (search && normalizeText(candidate.memberId ?? "") === search) ||
    (searchDigits && phoneDigits && searchDigits === phoneDigits)
  );
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

function fuzzyNameScore(searchText: string, candidateName: string) {
  const search = normalizeText(searchText);
  const name = normalizeText(candidateName);
  if (!search || !name) {
    return 0;
  }
  if (search === name) {
    return 1;
  }
  if (name.includes(search) || search.includes(name)) {
    return 0.96;
  }

  const searchTokens = search.split(/\s+/).filter(Boolean);
  const nameTokens = name.split(/\s+/).filter(Boolean);
  const sharedTokens = searchTokens.filter((token) => nameTokens.includes(token)).length;
  const sharedScore = sharedTokens / Math.max(searchTokens.length, nameTokens.length, 1);
  const distanceScore = 1 - editDistance(search, name) / Math.max(search.length, name.length, 1);

  return Math.max(sharedScore, distanceScore);
}

function dedupeCandidates(candidates: CandidateRow[]) {
  const seen = new Set<string>();
  const deduped: CandidateRow[] = [];

  candidates.forEach((candidate) => {
    const key = candidate.customerKey || `${normalizeText(candidate.customerName)}:${normalizeDigits(candidate.phoneNumber)}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(candidate);
    }
  });

  return deduped;
}

function fallbackSearchText(searchText: string) {
  const tokens = normalizeText(searchText).split(/\s+/).filter(Boolean);
  if (tokens.length < 3) {
    return "";
  }

  return tokens.slice(-2).join(" ");
}

function identityFromCandidate(candidate: CandidateRow, sourceScope: AgentSourceScope): ResolvedCustomerIdentity {
  return {
    customerKey: candidate.customerKey,
    customerName: candidate.customerName,
    customerPhone: candidate.phoneNumber ?? "",
    phoneMasked: candidate.phoneMasked ?? maskPhone(candidate.phoneNumber),
    memberId: candidate.memberId ?? undefined,
    joinedDate: candidate.joinedDate,
    sourceScope,
  };
}

function explicitIdentity(input: AgentToolInput): ResolvedCustomerIdentity | null {
  const explicit = input.entityContext;
  if (!explicit || !["customer", "appointment"].includes(explicit.entityType)) {
    return null;
  }

  const customerName = explicit.customerName ?? explicit.displayName ?? "";
  const customerPhone = explicit.customerPhone ?? "";
  const customerKey = explicit.customerKey ?? explicit.entityId;

  if (!customerKey || (!customerName && !customerPhone && !explicit.memberId)) {
    return null;
  }

  return {
    customerKey,
    customerName: customerName || customerPhone || explicit.memberId || "Selected customer",
    customerPhone,
    phoneMasked: explicit.customerPhoneMasked ?? maskPhone(customerPhone),
    memberId: explicit.memberId,
    joinedDate: null,
    sourceScope: "live",
  };
}

function missingCustomerNameWarning(): GreatTimeAgentWarning {
  return {
    type: "missing_customer_name",
    title: "Customer name needed",
    message: "Please choose a customer or send a customer name/phone.",
  };
}

function notFoundWarning(searchText: string): GreatTimeAgentWarning {
  return {
    type: "customer_not_found",
    title: "Customer not found",
    message: `I couldn’t find a customer named "${searchText}".`,
  };
}

function suggestionWarning(searchText: string): GreatTimeAgentWarning {
  return {
    type: "customer_suggestions",
    title: "Customer suggestion",
    message: `I couldn’t find an exact customer named "${searchText}". Please choose the closest match.`,
  };
}

async function searchLearnedProfiles(input: CustomerRelationshipProfileSearchInput) {
  return searchCustomerRelationshipProfilesBounded({
    ...input,
    limit: Math.min(Math.max(input.limit ?? 25, 1), 50),
    offset: 0,
    sortBy: input.sortBy ?? "lastVisitDate",
    sortDirection: input.sortDirection ?? "desc",
  });
}

function chooseFromCandidates(searchText: string, candidates: CandidateRow[], sourceScope: AgentSourceScope) {
  const exactCandidates = candidates.filter((candidate) => isExactCandidate(searchText, candidate));
  const selected = exactCandidates.length === 1 ? exactCandidates[0] : candidates.length === 1 ? candidates[0] : null;

  if (selected) {
    return { kind: "selected" as const, identity: identityFromCandidate(selected, sourceScope) };
  }

  if (exactCandidates.length > 1 || candidates.length > 1) {
    const scored = candidates
      .map((candidate) => ({ candidate, score: fuzzyNameScore(searchText, candidate.customerName) }))
      .sort((left, right) => right.score - left.score);
    const best = scored[0];
    const runnerUp = scored[1];

    if (best && best.score >= 0.82 && (!runnerUp || best.score - runnerUp.score >= 0.08)) {
      return { kind: "selected" as const, identity: identityFromCandidate(best.candidate, sourceScope) };
    }

    return { kind: "ambiguous" as const, candidates };
  }

  return { kind: "none" as const };
}

export function candidateRows(candidates: CandidateRow[]) {
  return limitRows(candidates, 10).map((candidate, index) => ({
    rank: index + 1,
    customerKey: candidate.customerKey,
    customerName: candidate.customerName,
    customerPhoneMasked: candidate.phoneMasked ?? maskPhone(candidate.phoneNumber),
    memberId: candidate.memberId ?? "",
    lastVisitDate: candidate.lastVisitDate ?? "",
    totalVisits: candidate.totalVisits ?? "",
  }));
}

export async function resolveCustomerIdentity(input: AgentToolInput): Promise<CustomerResolverResult> {
  const checkedAt = nowIso();
  const explicit = explicitIdentity(input);
  const sources: GreatTimeAgentSource[] = [];

  if (explicit) {
    return {
      status: "resolved",
      identity: explicit,
      sources: [
        source({
          tool: "resolve_customer_identity",
          sourceName: "Recent appointment/customer selection",
          checkedAt,
          dataStatus: "ok",
          scope: "live",
          live: true,
        }),
      ],
    };
  }

  const explicitContext = input.entityContext?.entityType === "customer" ? input.entityContext : undefined;
  const searchText =
    explicitContext?.memberId ??
    explicitContext?.customerPhone ??
    explicitContext?.customerName ??
    explicitContext?.displayName ??
    extractExplicitCustomerSearchText(input.request.message);

  if (!searchText) {
    return {
      status: "not_ready",
      searchText: "",
      sources,
      warnings: [missingCustomerNameWarning()],
    };
  }

  try {
    let candidates = await resolveCustomerPortalCandidates({
      clinicCode: input.clinic.clinicCode,
      search: searchText,
      limit: 10,
    });
    const broadSearchText = fallbackSearchText(searchText);
    if (candidates.length === 0 && broadSearchText) {
      candidates = await resolveCustomerPortalCandidates({
        clinicCode: input.clinic.clinicCode,
        search: broadSearchText,
        limit: 10,
      });
    }
    const candidateRowsForSource = dedupeCandidates(candidates);
    sources.push(
      source({
        tool: "resolve_customer_identity",
        sourceName: "Customer identity candidates",
        checkedAt,
        dataStatus: candidateRowsForSource.length ? "ok" : "not_found",
        scope: "historical",
      }),
    );

    const chosen = chooseFromCandidates(searchText, candidateRowsForSource, "historical");
    if (chosen.kind === "selected") {
      return { status: "resolved", identity: chosen.identity, sources };
    }
    if (chosen.kind === "ambiguous") {
      return { status: "ambiguous", searchText, candidates: chosen.candidates, sources };
    }
  } catch {
    sources.push(
      source({
        tool: "resolve_customer_identity",
        sourceName: "Customer identity candidates",
        checkedAt,
        dataStatus: "unavailable",
        scope: "historical",
      }),
    );
  }

  try {
    const learned = await searchLearnedProfiles({
      clinicId: input.clinic.clinicId,
      search: searchText,
      limit: 25,
    });
    const candidates = dedupeCandidates(
      learned.rows.map((profile) => ({
        customerKey: profile.customerKey,
        customerName: profile.customerName,
        phoneMasked: profile.customerPhoneMasked,
        memberId: profile.memberId,
        joinedDate: profile.firstSeenDate,
        lastVisitDate: profile.lastVisitDate,
        totalVisits: profile.totalVisits,
        lifetimeSpend: profile.lifetimeSpend,
      })),
    );
    sources.push(
      source({
        tool: "resolve_customer_identity_from_learned_profile",
        sourceName: "Customer relationship profiles",
        dataStatus: candidates.length ? "ok" : "not_found",
        scope: "learned",
      }),
    );

    const chosen = chooseFromCandidates(searchText, candidates, "learned");
    if (chosen.kind === "selected") {
      return { status: "resolved", identity: chosen.identity, sources };
    }
    if (chosen.kind === "ambiguous") {
      const fuzzySuggestions = candidates
        .map((candidate) => ({ candidate, score: fuzzyNameScore(searchText, candidate.customerName) }))
        .filter((candidate) => candidate.score >= 0.68)
        .sort((left, right) => right.score - left.score)
        .map((candidate) => candidate.candidate);

      if (fuzzySuggestions.length > 0 && fuzzySuggestions.length < candidates.length) {
        return {
          status: "suggestions",
          searchText,
          candidates: fuzzySuggestions,
          sources,
          warnings: [suggestionWarning(searchText)],
        };
      }

      return { status: "ambiguous", searchText, candidates: chosen.candidates, sources };
    }
  } catch {
    sources.push(
      source({
        tool: "resolve_customer_identity_from_learned_profile",
        sourceName: "Customer relationship profiles",
        dataStatus: "unavailable",
        scope: "learned",
      }),
    );
  }

  return {
    status: "not_found",
    searchText,
    sources,
    warnings: [notFoundWarning(searchText)],
  };
}
