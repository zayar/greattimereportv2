import type { GreatTimeAgentEntityContext } from "./types.js";

const ORDINALS: Array<[RegExp, number]> = [
  [/\bfirst\b|ပထမ/i, 1],
  [/\bsecond\b|ဒုတိယ/i, 2],
  [/\bthird\b|တတိယ/i, 3],
  [/\bfourth\b/i, 4],
  [/\bfifth\b/i, 5],
];

const ENTITY_REFERENCE = /\b(first|second|third|fourth|fifth|they|them|that customer|that service|that|her|him|it|သူ|အဲ့ဒီ)\b/i;

export function entityRefKey(ref: GreatTimeAgentEntityContext) {
  return `${ref.entityType}:${ref.entityId}`;
}

export function dedupeEntityRefs(refs: GreatTimeAgentEntityContext[]) {
  const seen = new Set<string>();
  const deduped: GreatTimeAgentEntityContext[] = [];

  refs.forEach((ref) => {
    const key = entityRefKey(ref);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(ref);
    }
  });

  return deduped.map((ref, index) => ({ ...ref, rank: ref.rank ?? index + 1 }));
}

export function resolveEntityReference(params: {
  message: string;
  explicit?: GreatTimeAgentEntityContext;
  sessionRefs?: GreatTimeAgentEntityContext[];
}) {
  if (params.explicit) {
    return params.explicit;
  }

  const refs = (params.sessionRefs ?? []).filter((ref) =>
    ["customer", "appointment", "service", "practitioner", "invoice"].includes(ref.entityType),
  );
  const ordinal = ORDINALS.find(([pattern]) => pattern.test(params.message))?.[1];

  if (ordinal) {
    return refs.find((ref) => ref.rank === ordinal) ?? refs[ordinal - 1] ?? null;
  }

  if (ENTITY_REFERENCE.test(params.message) && refs.length === 1) {
    return refs[0];
  }

  return null;
}

export function isEntityRefFresh(expiresAt: string | null | undefined, now = new Date()) {
  if (!expiresAt) {
    return true;
  }

  return new Date(expiresAt).getTime() > now.getTime();
}
