import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import type { AiLanguage } from "../../types/domain";

type AiPreferencesContextValue = {
  aiLanguage: AiLanguage;
  setAiLanguage: (next: AiLanguage) => void;
};

type PersistedPreferences = {
  aiLanguage?: AiLanguage;
};

const STORAGE_KEY = "gt_v2report.aiPreferences";

export const AI_LANGUAGE_OPTIONS: Array<{ value: AiLanguage; label: string }> = [
  { value: "my-MM", label: "Myanmar" },
  { value: "en-US", label: "English" },
];

const AiPreferencesContext = createContext<AiPreferencesContextValue | null>(null);

function isAiLanguage(value: unknown): value is AiLanguage {
  return value === "my-MM" || value === "en-US";
}

function readPersistedAiLanguage(): AiLanguage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return "my-MM";
    }

    const parsed = JSON.parse(raw) as PersistedPreferences;
    return isAiLanguage(parsed.aiLanguage) ? parsed.aiLanguage : "my-MM";
  } catch {
    return "my-MM";
  }
}

export function AiPreferencesProvider({ children }: PropsWithChildren) {
  const [aiLanguage, setAiLanguage] = useState<AiLanguage>(() => readPersistedAiLanguage());

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        aiLanguage,
      } satisfies PersistedPreferences),
    );
  }, [aiLanguage]);

  const value = useMemo<AiPreferencesContextValue>(
    () => ({
      aiLanguage,
      setAiLanguage,
    }),
    [aiLanguage],
  );

  return <AiPreferencesContext.Provider value={value}>{children}</AiPreferencesContext.Provider>;
}

export function useAiPreferences() {
  const value = useContext(AiPreferencesContext);
  if (!value) {
    throw new Error("useAiPreferences must be used within AiPreferencesProvider.");
  }

  return value;
}
