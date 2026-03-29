import { env } from "../../config/env.js";

export type AiJsonProvider = {
  modelName: string;
  generateJson: (prompt: string) => Promise<string>;
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
};

function extractCandidateText(payload: GeminiGenerateContentResponse) {
  return payload.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => part.text ?? "").join("").trim() ?? "";
}

function buildGeminiEndpoint(modelName: string) {
  const baseUrl = env.GEMINI_API_BASE_URL.replace(/\/+$/, "");
  return `${baseUrl}/models/${modelName}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY ?? "")}`;
}

function createGeminiProvider(): AiJsonProvider | null {
  if (!env.GEMINI_API_KEY) {
    return null;
  }

  return {
    modelName: env.GEMINI_MODEL,
    async generateJson(prompt: string) {
      const response = await fetch(buildGeminiEndpoint(env.GEMINI_MODEL), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
            maxOutputTokens: 900,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Gemini request failed with status ${response.status}.`);
      }

      const payload = (await response.json()) as GeminiGenerateContentResponse;
      if (payload.promptFeedback?.blockReason) {
        throw new Error(`Gemini blocked the request: ${payload.promptFeedback.blockReason}.`);
      }

      const text = extractCandidateText(payload);
      if (!text) {
        throw new Error("Gemini returned an empty response.");
      }

      return text;
    },
  };
}

export function createAiProvider(): AiJsonProvider | null {
  if (env.AI_PROVIDER === "gemini") {
    return createGeminiProvider();
  }

  return null;
}
