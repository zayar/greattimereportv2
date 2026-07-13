export type EntityResolutionCandidate<T> = {
  id: string;
  name: string;
  aliases?: Array<string | null | undefined>;
  value: T;
};

export type EntityCandidateResolution<T> =
  | { status: "resolved"; candidate: EntityResolutionCandidate<T>; confidence: number; matchType: "exact" | "fuzzy" }
  | { status: "ambiguous"; candidates: Array<EntityResolutionCandidate<T> & { confidence: number }>; confidence: number }
  | { status: "suggestions"; candidates: Array<EntityResolutionCandidate<T> & { confidence: number }>; confidence: number }
  | { status: "not_found"; candidates: []; confidence: 0 };

export function normalizeEntityText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(left: string, right: string) {
  const a = [...left];
  const b = [...right];
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= a.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= b.length; rightIndex += 1) {
      const substitutionCost = a[leftIndex - 1] === b[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + substitutionCost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length] ?? Math.max(a.length, b.length);
}

export function entityMatchScore(query: string, candidateText: string) {
  const search = normalizeEntityText(query);
  const candidate = normalizeEntityText(candidateText);
  if (!search || !candidate) {
    return 0;
  }
  if (search === candidate) {
    return 1;
  }
  if (candidate.includes(search) || search.includes(candidate)) {
    return 0.96;
  }

  const searchTokens = search.split(" ").filter(Boolean);
  const candidateTokens = candidate.split(" ").filter(Boolean);
  const sharedTokens = searchTokens.filter((token) => candidateTokens.includes(token)).length;
  const tokenScore = sharedTokens / Math.max(searchTokens.length, candidateTokens.length, 1);
  const distanceScore = 1 - editDistance(search, candidate) / Math.max(search.length, candidate.length, 1);
  return Math.max(tokenScore, distanceScore);
}

function candidateScore<T>(query: string, candidate: EntityResolutionCandidate<T>) {
  return Math.max(
    entityMatchScore(query, candidate.name),
    ...(candidate.aliases ?? []).map((alias) => entityMatchScore(query, alias ?? "")),
  );
}

export function resolveEntityCandidates<T>(params: {
  query: string;
  candidates: EntityResolutionCandidate<T>[];
  resolveThreshold?: number;
  suggestionThreshold?: number;
  minimumMargin?: number;
  maxCandidates?: number;
}): EntityCandidateResolution<T> {
  const resolveThreshold = params.resolveThreshold ?? 0.82;
  const suggestionThreshold = params.suggestionThreshold ?? 0.68;
  const minimumMargin = params.minimumMargin ?? 0.08;
  const maxCandidates = Math.min(Math.max(params.maxCandidates ?? 10, 1), 20);
  const scored = params.candidates
    .map((candidate) => ({ ...candidate, confidence: candidateScore(params.query, candidate) }))
    .filter((candidate) => candidate.confidence >= suggestionThreshold)
    .sort((left, right) => right.confidence - left.confidence || left.name.localeCompare(right.name))
    .slice(0, maxCandidates);

  if (scored.length === 0) {
    return { status: "not_found", candidates: [], confidence: 0 };
  }

  const exact = scored.filter((candidate) => candidate.confidence === 1);
  if (exact.length === 1) {
    return { status: "resolved", candidate: exact[0]!, confidence: 1, matchType: "exact" };
  }
  if (exact.length > 1) {
    return { status: "ambiguous", candidates: exact, confidence: 1 };
  }

  const best = scored[0]!;
  const runnerUp = scored[1];
  if (
    best.confidence >= resolveThreshold &&
    (!runnerUp || best.confidence - runnerUp.confidence >= minimumMargin)
  ) {
    return { status: "resolved", candidate: best, confidence: best.confidence, matchType: "fuzzy" };
  }

  if (scored.length > 1) {
    return { status: "ambiguous", candidates: scored, confidence: best.confidence };
  }

  return { status: "suggestions", candidates: scored, confidence: best.confidence };
}
