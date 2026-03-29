export const supportedAiLanguages = ["my-MM", "en-US"] as const;

export type AiLanguage = (typeof supportedAiLanguages)[number];

export const DEFAULT_AI_LANGUAGE: AiLanguage = "my-MM";

export function resolveAiLanguage(value: unknown, fallback: AiLanguage = DEFAULT_AI_LANGUAGE): AiLanguage {
  return typeof value === "string" && supportedAiLanguages.includes(value as AiLanguage)
    ? (value as AiLanguage)
    : fallback;
}

export function isMyanmarLanguage(language: AiLanguage) {
  return language === "my-MM";
}

export function formatAiLanguageLabel(language: AiLanguage) {
  return isMyanmarLanguage(language) ? "Myanmar" : "English";
}
