import { createHash } from "node:crypto";
import { nowIso } from "../safety.js";
import type {
  GtAgentMemoryPolicyDecision,
  GtAgentMemoryRecord,
  GtAgentMemoryWriteInput,
} from "./memory-types.js";

const TRANSIENT_METRIC_PATTERN =
  /\b(today|yesterday|now|current|currently|right now|ဒီနေ့|မနေ့|အခု|ယခု)\b[\s\S]{0,80}\b(sales?|revenue|payment|collection|balance|amount|appointments?|bookings?|ငွေ|ရောင်း|လက်ကျန်)\b|\b(sales?|revenue|payment|collection|balance|amount|appointments?|bookings?|ငွေ|ရောင်း|လက်ကျန်)\b[\s\S]{0,80}\b(today|yesterday|now|current|currently|right now|ဒီနေ့|မနေ့|အခု|ယခု)\b/i;
const EXACT_NUMBER_PATTERN = /(?:\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\s*(?:mmk|kyat|ks|k|%)\b|\b\d{4,}\b)/i;
const SECRET_PATTERN = /\b(?:bearer|api[_ -]?key|secret|token|password|private[_ -]?key|authorization)\b/i;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{6,}\d)/;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function clampConfidence(value: number) {
  return Math.max(0, Math.min(1, value));
}

function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export function buildMemoryId(input: Pick<GtAgentMemoryWriteInput, "clinicId" | "userId" | "memoryType" | "content" | "entityType" | "entityId">) {
  return `mem_${stableHash([
    input.clinicId,
    input.userId ?? "clinic",
    input.memoryType,
    input.entityType ?? "",
    input.entityId ?? "",
    input.content.trim().toLowerCase(),
  ].join("|"))}`;
}

export function evaluateMemoryCandidate(input: GtAgentMemoryWriteInput): GtAgentMemoryPolicyDecision {
  const content = input.content.trim();
  const evidenceCount = input.evidenceCount ?? 1;

  if (!input.clinicId.trim()) {
    return { accepted: false, reason: "Memory rejected because clinic scope is missing." };
  }

  if (!content) {
    return { accepted: false, reason: "Memory rejected because content is empty." };
  }

  if (SECRET_PATTERN.test(content)) {
    return { accepted: false, reason: "Memory rejected because it appears to contain a secret." };
  }

  if (EMAIL_PATTERN.test(content) || PHONE_PATTERN.test(content)) {
    return { accepted: false, reason: "Memory rejected because it contains unnecessary PII." };
  }

  if (TRANSIENT_METRIC_PATTERN.test(content) && EXACT_NUMBER_PATTERN.test(content)) {
    return { accepted: false, reason: "Memory rejected because exact transient metrics must remain source-backed facts." };
  }

  if (input.source === "explicit_user") {
    return {
      accepted: true,
      status: "active",
      confidence: clampConfidence(input.confidence ?? 0.92),
    };
  }

  if (input.source === "verified_outcome") {
    return {
      accepted: true,
      status: evidenceCount >= 1 ? "active" : "candidate",
      confidence: clampConfidence(input.confidence ?? 0.84),
    };
  }

  if (evidenceCount >= 2) {
    return {
      accepted: true,
      status: "active",
      confidence: clampConfidence(input.confidence ?? 0.74),
    };
  }

  return {
    accepted: true,
    status: "candidate",
    confidence: clampConfidence(input.confidence ?? 0.48),
  };
}

export function buildMemoryRecord(input: GtAgentMemoryWriteInput, now = nowIso()): GtAgentMemoryRecord | null {
  const decision = evaluateMemoryCandidate(input);
  if (!decision.accepted) {
    return null;
  }

  return {
    id: buildMemoryId(input),
    clinicId: input.clinicId,
    userId: input.userId ?? null,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    agentId: input.agentId ?? null,
    intent: input.intent ?? null,
    memoryType: input.memoryType,
    content: input.content.trim(),
    source: input.source,
    status: decision.status,
    confidence: decision.confidence,
    evidenceCount: input.evidenceCount ?? 1,
    sourceEventIds: input.sourceEventIds ?? [],
    createdAt: now,
    updatedAt: now,
    lastObservedAt: input.observedAt ?? now,
    validFrom: now,
    validUntil: null,
    supersededByMemoryId: null,
  };
}
