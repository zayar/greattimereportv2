import type { AgentFeedbackInput, GreatTimeAgentChatResponse } from "../types.js";
import { buildMemoryRecord } from "./memory-policy.js";
import { saveMemoryRecord } from "./memory.repository.js";
import type { GtAgentMemoryRecord, GtAgentMemoryWriteInput, GtAgentRelevantMemory } from "./memory-types.js";

export type FeedbackLearningEvent = AgentFeedbackInput & {
  id: string;
  clinicId: string;
  userId: string;
  createdAt: string;
  resolvedAgent?: GreatTimeAgentChatResponse["resolvedAgent"] | null;
  intent?: string | null;
};

function normalizeText(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function explicitPreferenceFromNote(note: string): Pick<GtAgentMemoryWriteInput, "memoryType" | "content">[] {
  const normalized = note.toLowerCase();
  const preferences: Pick<GtAgentMemoryWriteInput, "memoryType" | "content">[] = [];

  if (/short|concise|brief|တို|အကျဉ်း/i.test(note)) {
    preferences.push({
      memoryType: "response_style",
      content: "Owner prefers concise answers with short summaries.",
    });
  }

  if (/myanmar|burmese|မြန်မာ/i.test(note)) {
    preferences.push({
      memoryType: "language_preference",
      content: "Owner prefers Myanmar language replies when the question allows it.",
    });
  }

  if (/unused[- ]?package|package opportunities|package balance|လက်ကျန်/i.test(normalized)) {
    preferences.push({
      memoryType: "priority_preference",
      content: "Owner wants unused-package recovery opportunities shown before lower-priority recommendations.",
    });
  }

  return preferences;
}

export function buildMemoryCandidatesFromFeedbackEvents(
  events: FeedbackLearningEvent[],
): GtAgentMemoryWriteInput[] {
  const candidates: GtAgentMemoryWriteInput[] = [];
  const repeatedSignals = new Map<string, FeedbackLearningEvent[]>();

  events.forEach((event) => {
    const note = normalizeText(event.note);
    const feedbackType = event.feedbackType ?? event.rating;

    if (feedbackType === "remember_this" || feedbackType === "correction" || /please|prefer|remember|keep|show/i.test(note)) {
      explicitPreferenceFromNote(note).forEach((preference) => {
        candidates.push({
          clinicId: event.clinicId,
          userId: event.userId,
          agentId: event.resolvedAgent ?? undefined,
          intent: event.intent ?? undefined,
          memoryType: preference.memoryType,
          content: preference.content,
          source: "explicit_user",
          confidence: 0.94,
          evidenceCount: 1,
          sourceEventIds: [event.id],
          observedAt: event.createdAt,
        });
      });
    }

    if (feedbackType === "too_long" || feedbackType === "too_short" || feedbackType === "wrong_data") {
      const key = `${event.clinicId}|${event.userId}|${feedbackType}|${event.resolvedAgent ?? "agent"}|${event.intent ?? "intent"}`;
      repeatedSignals.set(key, [...(repeatedSignals.get(key) ?? []), event]);
    }
  });

  repeatedSignals.forEach((group) => {
    if (group.length < 2) {
      return;
    }

    const first = group[0];
    const feedbackType = first.feedbackType ?? first.rating;
    const content =
      feedbackType === "too_long"
        ? "Owner often marks responses too long; prefer concise answers for this area."
        : feedbackType === "too_short"
          ? "Owner often marks responses too short; include one extra supporting detail for this area."
          : "Owner reported repeated data-quality issues for this agent area; add data-quality caution before ranking recommendations.";

    candidates.push({
      clinicId: first.clinicId,
      userId: first.userId,
      agentId: first.resolvedAgent ?? undefined,
      intent: first.intent ?? undefined,
      memoryType: feedbackType === "wrong_data" ? "data_quality" : "response_style",
      content,
      source: "feedback",
      confidence: 0.72,
      evidenceCount: group.length,
      sourceEventIds: group.map((event) => event.id),
      observedAt: group[group.length - 1]?.createdAt,
    });
  });

  return candidates;
}

export function buildMemoryRecordsFromFeedbackEvents(
  events: FeedbackLearningEvent[],
  now?: string,
): GtAgentMemoryRecord[] {
  return buildMemoryCandidatesFromFeedbackEvents(events)
    .map((candidate) => buildMemoryRecord(candidate, now))
    .filter((memory): memory is GtAgentMemoryRecord => memory != null);
}

export async function learnMemoriesFromFeedbackEvents(events: FeedbackLearningEvent[]) {
  const records = buildMemoryRecordsFromFeedbackEvents(events);
  await Promise.all(records.map((record) => saveMemoryRecord(record)));
  return records;
}

export function applyMemoryPreferencesToResponse<T extends GreatTimeAgentChatResponse>(
  response: T,
  memories: GtAgentRelevantMemory[],
): T {
  if (memories.length === 0) {
    return response;
  }

  const concise = memories.some((memory) => /concise|short|တို|အကျဉ်း/i.test(memory.content));
  const prioritizeUnusedPackages = memories.some((memory) => /unused-package|unused package|package balance|လက်ကျန်/i.test(memory.content));
  const recommendations = response.recommendations ? [...response.recommendations] : undefined;

  if (prioritizeUnusedPackages && recommendations) {
    recommendations.sort((left, right) => {
      const leftMatch = /unused|package|balance|လက်ကျန်/i.test(`${left.title ?? ""} ${left.message}`) ? 1 : 0;
      const rightMatch = /unused|package|balance|လက်ကျန်/i.test(`${right.title ?? ""} ${right.message}`) ? 1 : 0;
      return rightMatch - leftMatch;
    });
  }

  return {
    ...response,
    recommendations,
    followUpQuestions: concise ? response.followUpQuestions?.slice(0, 2) : response.followUpQuestions,
    usedMemoryIds: memories.map((memory) => memory.id),
  };
}
