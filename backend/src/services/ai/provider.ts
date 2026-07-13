import { env } from "../../config/env.js";

export type AiJsonProvider = {
  modelName: string;
  generateJson: (prompt: string, options?: { timeoutMs?: number }) => Promise<string>;
  generateStructuredJson?: (
    prompt: string,
    options?: AiStructuredJsonOptions,
  ) => Promise<AiStructuredJsonResult>;
};

export type AiJsonSchema = Record<string, unknown>;

export type AiStructuredJsonOptions = {
  timeoutMs?: number;
  modelName?: string;
  responseSchema?: AiJsonSchema;
  temperature?: number;
  maxOutputTokens?: number;
};

export type AiStructuredJsonResult = {
  text: string;
  provider: "gemini";
  modelName: string;
  usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
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
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

function extractCandidateText(payload: GeminiGenerateContentResponse) {
  return payload.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => part.text ?? "").join("").trim() ?? "";
}

function buildGeminiEndpoint(modelName: string) {
  const baseUrl = env.GEMINI_API_BASE_URL.replace(/\/+$/, "");
  return `${baseUrl}/models/${modelName}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY ?? "")}`;
}

export function createGeminiProvider(): AiJsonProvider | null {
  if (!env.GEMINI_API_KEY) {
    return null;
  }

  const generateStructuredJson = async (
    prompt: string,
    options?: AiStructuredJsonOptions,
  ): Promise<AiStructuredJsonResult> => {
    const modelName = options?.modelName ?? env.GEMINI_MODEL;
    const timeoutMs = options?.timeoutMs;
    const controller = timeoutMs && timeoutMs > 0 ? new AbortController() : undefined;
    const timeoutHandle = controller
      ? setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : undefined;

    const response = await fetch(buildGeminiEndpoint(modelName), {
      method: "POST",
      signal: controller?.signal,
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
          temperature: options?.temperature ?? 0.2,
          maxOutputTokens: options?.maxOutputTokens ?? 900,
          ...(options?.responseSchema ? { responseSchema: options.responseSchema } : {}),
        },
      }),
    }).finally(() => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
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

    return {
      text,
      provider: "gemini",
      modelName,
      usage: {
        promptTokens: payload.usageMetadata?.promptTokenCount,
        completionTokens: payload.usageMetadata?.candidatesTokenCount,
        totalTokens: payload.usageMetadata?.totalTokenCount,
      },
    };
  };

  return {
    modelName: env.GEMINI_MODEL,
    async generateJson(prompt: string, options?: { timeoutMs?: number }) {
      return (await generateStructuredJson(prompt, options)).text;
    },
    generateStructuredJson,
  };
}

export function createAiProvider(): AiJsonProvider | null {
  if (env.AI_PROVIDER === "gemini") {
    return createGeminiProvider();
  }

  return null;
}
