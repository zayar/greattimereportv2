import { AI_LANGUAGE_OPTIONS } from "./AiPreferencesProvider";
import type { AiLanguage, CustomerPortalListResponse } from "../../types/domain";

export function formatAiLanguageLabel(language: AiLanguage) {
  return AI_LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ?? language;
}

export function formatChurnRiskLabel(level: CustomerPortalListResponse["rows"][number]["churnRiskLevel"]) {
  if (level === "high") {
    return "High risk";
  }

  if (level === "medium") {
    return "Medium risk";
  }

  return "Low risk";
}

export function churnRiskTone(level: CustomerPortalListResponse["rows"][number]["churnRiskLevel"]) {
  if (level === "high") {
    return "attention";
  }

  if (level === "medium") {
    return "neutral";
  }

  return "positive";
}

export function formatRebookingStatusLabel(
  status: CustomerPortalListResponse["rows"][number]["rebookingStatus"],
) {
  if (status === "dueSoon") {
    return "Due soon";
  }

  if (status === "overdue") {
    return "Overdue";
  }

  if (status === "onTrack") {
    return "On track";
  }

  return "Unknown";
}

export function rebookingTone(status: CustomerPortalListResponse["rows"][number]["rebookingStatus"]) {
  if (status === "overdue") {
    return "attention";
  }

  if (status === "dueSoon") {
    return "neutral";
  }

  if (status === "onTrack") {
    return "positive";
  }

  return "neutral";
}
