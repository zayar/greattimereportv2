import { createHash } from "node:crypto";
import { env } from "../../config/env.js";
import type { ConsultantCatalogService } from "./service-catalog.service.js";
import {
  consultantKnowledgeSuggestionSchema,
  emptyConsultantKnowledgeContent,
  type ConsultantKnowledgeContent,
  type ConsultantKnowledgeSuggestion,
} from "./service-knowledge.schemas.js";

const OPENAI_RESPONSES_PATH = "/responses";

const localeJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    overview: { type: "string", maxLength: 2_000 },
    serviceAliases: stringListSchema(),
    concerns: stringListSchema(),
    suitableFor: stringListSchema(),
    notSuitableFor: stringListSchema(),
    benefits: stringListSchema(),
    limitations: stringListSchema(),
    preparation: stringListSchema(),
    aftercare: stringListSchema(),
    expectedResults: stringListSchema(),
    consultationQuestions: stringListSchema(),
    escalationRules: stringListSchema(),
  },
  required: [
    "overview",
    "serviceAliases",
    "concerns",
    "suitableFor",
    "notSuitableFor",
    "benefits",
    "limitations",
    "preparation",
    "aftercare",
    "expectedResults",
    "consultationQuestions",
    "escalationRules",
  ],
} as const;

export const CONSULTANT_KNOWLEDGE_SUGGESTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    content: {
      type: "object",
      additionalProperties: false,
      properties: {
        en: localeJsonSchema,
        my: localeJsonSchema,
      },
      required: ["en", "my"],
    },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    warnings: stringListSchema(20),
    missingInformation: stringListSchema(20),
    reviewNotes: stringListSchema(20),
  },
  required: ["content", "confidence", "warnings", "missingInformation", "reviewNotes"],
} as const;

const CONSULTANT_KNOWLEDGE_INSTRUCTIONS = `
You prepare bilingual service-knowledge drafts for trained clinic staff to review.

Return only the requested structured object. Write clear customer-friendly English and natural Myanmar content with equivalent meaning. Keep product and device names unchanged when translation would make them ambiguous.

Source and safety boundaries:
- Treat the supplied API Core service record and current staff draft as the only clinic-supplied context; neither is automatically clinically verified.
- Preserve useful wording already present in the current staff draft, but do not silently strengthen its claims.
- You may use conservative general industry knowledge only when it is widely applicable; identify every assumption in warnings.
- Never diagnose, prescribe, guarantee outcomes, or claim that a service is appropriate for a particular person.
- Do not invent protocols, device settings, treatment frequency, recovery time, contraindications, medication advice, pregnancy guidance, or required session counts.
- If the input does not support a field, return an empty value and explain what clinic information is missing.
- Use conditional wording such as "may" and "can be discussed" for benefits and suitability.
- Escalate severe pain, rapidly worsening symptoms, infection signs, open wounds, breathing difficulty, eye involvement, allergic reaction, or other urgent concerns to qualified medical assessment.
- Keep price and duration out of the generated knowledge content because GT API Core supplies them live.
- Consultation questions must collect relevant context without attempting diagnosis.
- Keep each list focused and non-repetitive, normally no more than six items.
- Use low confidence when the API Core description is missing, promotional, mixed-language, or insufficient to support safe guidance.

The output is an editable suggestion. It must never imply that it is clinically approved or ready to publish.
`.trim();

type OpenAiResponsesPayload = {
  id?: string;
  model?: string;
  status?: string;
  error?: { message?: string } | null;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

export type ConsultantKnowledgeSuggestionResult = ConsultantKnowledgeSuggestion & {
  generation: {
    responseId: string | null;
    model: string;
    generatedAt: string;
    usage: {
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens: number | null;
    };
  };
};

type SuggestionDependencies = {
  apiKey?: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  model?: string;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  timeoutMs?: number;
  maxOutputTokens?: number;
  now?: () => Date;
};

export class ConsultantKnowledgeSuggestionUnavailableError extends Error {}

function stringListSchema(maxItems = 40) {
  return {
    type: "array",
    maxItems,
    items: { type: "string", minLength: 1, maxLength: 240 },
  } as const;
}

export function buildConsultantKnowledgeSuggestionInput(params: {
  service: ConsultantCatalogService;
  currentContent?: ConsultantKnowledgeContent;
}) {
  return JSON.stringify(
    {
      task: "Create a cautious bilingual Consultant service-knowledge draft for staff review.",
      service: {
        name: params.service.serviceName,
        description: params.service.description?.slice(0, 8_000) ?? null,
        durationMinutes: params.service.durationMinutes,
      },
      currentStaffDraft: params.currentContent ?? emptyConsultantKnowledgeContent(),
    },
    null,
    2,
  );
}

export function consultantSafetyIdentifier(actorId: string) {
  return `gtv2_${createHash("sha256").update(actorId).digest("hex").slice(0, 32)}`;
}

function responseText(payload: OpenAiResponsesPayload) {
  const refusal = payload.output
    ?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === "refusal" && item.refusal)?.refusal;
  if (refusal) {
    throw new ConsultantKnowledgeSuggestionUnavailableError(
      "GPT-5.6 could not generate this draft. No knowledge was changed.",
    );
  }

  return payload.output
    ?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text ?? "")
    .join("")
    .trim() ?? "";
}

export async function generateConsultantKnowledgeSuggestion(
  params: {
    service: ConsultantCatalogService;
    currentContent?: ConsultantKnowledgeContent;
    actorId: string;
  },
  dependencies: SuggestionDependencies = {},
): Promise<ConsultantKnowledgeSuggestionResult> {
  const apiKey = dependencies.apiKey ?? env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ConsultantKnowledgeSuggestionUnavailableError(
      "AI suggestions are not configured. Add the OpenAI API key and redeploy GT V2.",
    );
  }

  const model = dependencies.model ?? env.OPENAI_CONSULTANT_KNOWLEDGE_MODEL;
  const reasoningEffort = dependencies.reasoningEffort ?? env.OPENAI_CONSULTANT_KNOWLEDGE_REASONING_EFFORT;
  const timeoutMs = dependencies.timeoutMs ?? env.OPENAI_CONSULTANT_KNOWLEDGE_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  const endpoint = `${(dependencies.apiBaseUrl ?? env.OPENAI_API_BASE_URL).replace(/\/+$/, "")}${OPENAI_RESPONSES_PATH}`;

  let response: Response;
  try {
    response = await (dependencies.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: CONSULTANT_KNOWLEDGE_INSTRUCTIONS,
        input: buildConsultantKnowledgeSuggestionInput(params),
        reasoning: { effort: reasoningEffort },
        max_output_tokens: dependencies.maxOutputTokens ?? env.OPENAI_CONSULTANT_KNOWLEDGE_MAX_OUTPUT_TOKENS,
        store: false,
        safety_identifier: consultantSafetyIdentifier(params.actorId),
        text: {
          verbosity: "medium",
          format: {
            type: "json_schema",
            name: "consultant_service_knowledge_suggestion",
            strict: true,
            schema: CONSULTANT_KNOWLEDGE_SUGGESTION_JSON_SCHEMA,
          },
        },
      }),
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "GPT-5.6 took too long to prepare the draft. No knowledge was changed."
      : "GPT-5.6 is temporarily unavailable. No knowledge was changed.";
    throw new ConsultantKnowledgeSuggestionUnavailableError(message);
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!response.ok) {
    throw new ConsultantKnowledgeSuggestionUnavailableError(
      response.status === 429
        ? "GPT-5.6 is busy or the OpenAI usage limit was reached. Try again shortly."
        : "GPT-5.6 could not prepare the draft. No knowledge was changed.",
    );
  }

  let payload: OpenAiResponsesPayload;
  try {
    payload = (await response.json()) as OpenAiResponsesPayload;
  } catch {
    throw new ConsultantKnowledgeSuggestionUnavailableError(
      "GPT-5.6 returned a response that could not be validated. No knowledge was changed.",
    );
  }
  const text = responseText(payload);
  if (!text) {
    throw new ConsultantKnowledgeSuggestionUnavailableError(
      "GPT-5.6 returned an empty draft. No knowledge was changed.",
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    throw new ConsultantKnowledgeSuggestionUnavailableError(
      "GPT-5.6 returned a draft that could not be validated. No knowledge was changed.",
    );
  }

  const parsed = consultantKnowledgeSuggestionSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new ConsultantKnowledgeSuggestionUnavailableError(
      "GPT-5.6 returned a draft that could not be validated. No knowledge was changed.",
    );
  }

  return {
    ...parsed.data,
    generation: {
      responseId: payload.id ?? null,
      model: payload.model ?? model,
      generatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
      usage: {
        inputTokens: payload.usage?.input_tokens ?? null,
        outputTokens: payload.usage?.output_tokens ?? null,
        totalTokens: payload.usage?.total_tokens ?? null,
      },
    },
  };
}

export const __test = {
  CONSULTANT_KNOWLEDGE_INSTRUCTIONS,
  responseText,
};
