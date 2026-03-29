import { AI_LANGUAGE_OPTIONS, useAiPreferences } from "./AiPreferencesProvider";

type Props = {
  className?: string;
};

export function AiLanguageSelector({ className }: Props) {
  const { aiLanguage, setAiLanguage } = useAiPreferences();

  return (
    <label className={`field field--compact ${className ?? ""}`.trim()}>
      <span>AI language</span>
      <select value={aiLanguage} onChange={(event) => setAiLanguage(event.target.value as typeof aiLanguage)}>
        {AI_LANGUAGE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
