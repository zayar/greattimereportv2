import type { AgentFeedbackInput, GreatTimeAgentChatResponse } from "../types.js";
import { buildMemoryRecord } from "./memory-policy.js";
import { saveMemoryRecord } from "./memory.repository.js";
import type {
  GtAgentMemoryRecord,
  GtAgentMemoryWriteInput,
  GtAgentPreferenceKey,
  GtAgentPreferenceValue,
  GtAgentRelevantMemory,
} from "./memory-types.js";

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

function explicitPreferenceFromNote(
  note: string,
): Array<Pick<GtAgentMemoryWriteInput, "memoryType" | "content" | "preferenceKey" | "preferenceValue">> {
  const normalized = note.toLowerCase();
  const preferences: Array<Pick<GtAgentMemoryWriteInput, "memoryType" | "content" | "preferenceKey" | "preferenceValue">> = [];

  if (/short|concise|brief|တို|အကျဉ်း/i.test(note)) {
    preferences.push({
      memoryType: "response_style",
      preferenceKey: "response.detail_level",
      preferenceValue: "concise",
      content: "Owner prefers concise answers with short summaries.",
    });
  }

  if (/detail|explain|thorough|more context|အသေးစိတ်/i.test(note) && !/too much detail/i.test(normalized)) {
    preferences.push({
      memoryType: "response_style",
      preferenceKey: "response.detail_level",
      preferenceValue: "detailed",
      content: "Owner prefers answers with extra supporting detail.",
    });
  }

  if (/table|list|bullet|columns?|ဇယား/i.test(note)) {
    preferences.push({
      memoryType: "response_style",
      preferenceKey: "response.format",
      preferenceValue: /table|columns?|ဇယား/i.test(note) ? "table" : "bullets",
      content: /table|columns?|ဇယား/i.test(note)
        ? "Owner prefers tabular answers when comparing records."
        : "Owner prefers bullet-list answers for summaries.",
    });
  }

  if (/myanmar|burmese|မြန်မာ/i.test(note)) {
    preferences.push({
      memoryType: "language_preference",
      preferenceKey: "response.language",
      preferenceValue: "my",
      content: "Owner prefers Myanmar language replies when the question allows it.",
    });
  }

  if (/\benglish\b|အင်္ဂလိပ်/i.test(note)) {
    preferences.push({
      memoryType: "language_preference",
      preferenceKey: "response.language",
      preferenceValue: "en",
      content: "Owner prefers English language replies when the question allows it.",
    });
  }

  if (/unused[- ]?package|package opportunities|package balance|လက်ကျန်/i.test(normalized)) {
    preferences.push({
      memoryType: "priority_preference",
      preferenceKey: "recommendation.priority",
      preferenceValue: ["unused_package_recovery"],
      content: "Owner wants unused-package recovery opportunities shown before lower-priority recommendations.",
    });
  }

  return preferences;
}

function feedbackSignalPreference(
  feedbackType: AgentFeedbackInput["feedbackType"] | AgentFeedbackInput["rating"],
): {
  memoryType: GtAgentMemoryWriteInput["memoryType"];
  preferenceKey?: GtAgentPreferenceKey;
  preferenceValue?: GtAgentPreferenceValue;
  content: string;
} | null {
  if (feedbackType === "too_long") {
    return {
      memoryType: "response_style",
      preferenceKey: "response.detail_level",
      preferenceValue: "concise",
      content: "Owner often marks responses too long; prefer concise answers for this area.",
    };
  }

  if (feedbackType === "too_short") {
    return {
      memoryType: "response_style",
      preferenceKey: "response.detail_level",
      preferenceValue: "detailed",
      content: "Owner often marks responses too short; include one extra supporting detail for this area.",
    };
  }

  if (feedbackType === "wrong_data" || feedbackType === "correction") {
    return {
      memoryType: "data_quality",
      content: "Owner reported data-quality concern for this agent area; verify live sources before making recommendations.",
    };
  }

  return null;
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
          preferenceKey: preference.preferenceKey,
          preferenceValue: preference.preferenceValue,
          content: preference.content,
          source: "explicit_user",
          confidence: 0.94,
          evidenceCount: 1,
          sourceEventIds: [event.id],
          sourceSessionIds: [event.sessionId],
          observedAt: event.createdAt,
        });
      });
    }

    if (feedbackSignalPreference(feedbackType)) {
      const key = `${event.clinicId}|${event.userId}|${feedbackType}|${event.resolvedAgent ?? "agent"}|${event.intent ?? "intent"}`;
      repeatedSignals.set(key, [...(repeatedSignals.get(key) ?? []), event]);
    }
  });

  repeatedSignals.forEach((group) => {
    const first = group[0];
    const feedbackType = first.feedbackType ?? first.rating;
    const signal = feedbackSignalPreference(feedbackType);

    if (!signal) {
      return;
    }

    candidates.push({
      clinicId: first.clinicId,
      userId: first.userId,
      agentId: first.resolvedAgent ?? undefined,
      intent: first.intent ?? undefined,
      memoryType: signal.memoryType,
      preferenceKey: signal.preferenceKey,
      preferenceValue: signal.preferenceValue,
      content: signal.content,
      source: "feedback",
      confidence: group.length >= 3 ? 0.72 : 0.48,
      evidenceCount: group.length,
      sourceEventIds: group.map((event) => event.id),
      sourceSessionIds: group.map((event) => event.sessionId),
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
  return Promise.all(records.map((record) => saveMemoryRecord(record)));
}

export function applyMemoryPreferencesToResponse<T extends GreatTimeAgentChatResponse>(
  response: T,
  memories: GtAgentRelevantMemory[],
): T {
  if (memories.length === 0) {
    return response;
  }

  const concise = memories.some((memory) => /concise|short|တို|အကျဉ်း/i.test(memory.content));
  const detailed = memories.some(
    (memory) => memory.preferenceKey === "response.detail_level" && memory.preferenceValue === "detailed",
  );
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
    followUpQuestions: concise && !detailed ? response.followUpQuestions?.slice(0, 2) : response.followUpQuestions,
    usedMemoryIds: memories.map((memory) => memory.id),
  };
}
