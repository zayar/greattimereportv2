import { createHash, createHmac, timingSafeEqual } from "node:crypto";
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
  error?: { code?: string; message?: string; type?: string } | null;
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

export type ConsultantKnowledgeSuggestionProgress =
  | {
      status: "queued" | "in_progress";
      job: {
        responseId: string;
        jobToken: string;
        model: string;
      };
    }
  | {
      status: "completed";
      suggestion: ConsultantKnowledgeSuggestionResult;
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

export function consultantSuggestionJobToken(params: {
  apiKey: string;
  actorId: string;
  serviceId: string;
  responseId: string;
}) {
  return createHmac("sha256", params.apiKey)
    .update(JSON.stringify([params.actorId, params.serviceId, params.responseId]))
    .digest("base64url");
}

function isValidJobToken(params: {
  apiKey: string;
  actorId: string;
  serviceId: string;
  responseId: string;
  jobToken: string;
}) {
  const expected = consultantSuggestionJobToken(params);
  const actualBuffer = Buffer.from(params.jobToken);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
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

function apiKeyFrom(dependencies: SuggestionDependencies) {
  const apiKey = dependencies.apiKey ?? env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ConsultantKnowledgeSuggestionUnavailableError(
      "AI suggestions are not configured. Add the OpenAI API key and redeploy GT V2.",
    );
  }
  return apiKey;
}

function openAiEndpoint(dependencies: SuggestionDependencies, responseId?: string) {
  const base = (dependencies.apiBaseUrl ?? env.OPENAI_API_BASE_URL).replace(/\/+$/, "");
  return responseId
    ? `${base}${OPENAI_RESPONSES_PATH}/${encodeURIComponent(responseId)}`
    : `${base}${OPENAI_RESPONSES_PATH}`;
}

function openAiRequestBody(
  params: {
    service: ConsultantCatalogService;
    currentContent?: ConsultantKnowledgeContent;
    actorId: string;
  },
  dependencies: SuggestionDependencies,
  background: boolean,
) {
  return {
    model: dependencies.model ?? env.OPENAI_CONSULTANT_KNOWLEDGE_MODEL,
    instructions: CONSULTANT_KNOWLEDGE_INSTRUCTIONS,
    input: buildConsultantKnowledgeSuggestionInput(params),
    reasoning: {
      effort: dependencies.reasoningEffort ?? env.OPENAI_CONSULTANT_KNOWLEDGE_REASONING_EFFORT,
    },
    max_output_tokens: dependencies.maxOutputTokens ?? env.OPENAI_CONSULTANT_KNOWLEDGE_MAX_OUTPUT_TOKENS,
    background,
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
  };
}

async function readOpenAiPayload(response: Response) {
  let payload: OpenAiResponsesPayload;
  try {
    payload = (await response.json()) as OpenAiResponsesPayload;
  } catch {
    throw new ConsultantKnowledgeSuggestionUnavailableError(
      "GPT-5.6 returned a response that could not be validated. No knowledge was changed.",
    );
  }

  if (!response.ok) {
    const message = response.status === 401 || response.status === 403
      ? "OpenAI rejected the configured API credentials. Update OPENAI_API_KEY and redeploy GT V2."
      : response.status === 404
        ? "GPT-5.6 Sol is not available to this OpenAI project. Confirm model access and try again."
        : response.status === 429
          ? "GPT-5.6 is busy or the OpenAI usage limit was reached. Try again shortly."
          : response.status === 400
            ? "OpenAI rejected the Consultant draft request. No knowledge was changed."
            : "GPT-5.6 could not prepare the draft. No knowledge was changed.";
    throw new ConsultantKnowledgeSuggestionUnavailableError(message);
  }

  if (payload.status === "failed" || payload.status === "cancelled") {
    throw new ConsultantKnowledgeSuggestionUnavailableError(
      "GPT-5.6 could not complete the draft. No knowledge was changed.",
    );
  }

  return payload;
}

async function requestOpenAi(params: {
  endpoint: string;
  apiKey: string;
  method: "GET" | "POST";
  body?: Record<string, unknown>;
  dependencies: SuggestionDependencies;
}) {
  const timeoutMs = params.dependencies.timeoutMs ?? env.OPENAI_CONSULTANT_KNOWLEDGE_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await (params.dependencies.fetchImpl ?? fetch)(params.endpoint, {
      method: params.method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: params.body ? JSON.stringify(params.body) : undefined,
    });
    return await readOpenAiPayload(response);
  } catch (error) {
    if (error instanceof ConsultantKnowledgeSuggestionUnavailableError) {
      throw error;
    }
    const message = error instanceof Error && error.name === "AbortError"
      ? "GPT-5.6 took too long to respond. No knowledge was changed."
      : "GPT-5.6 is temporarily unavailable. No knowledge was changed.";
    throw new ConsultantKnowledgeSuggestionUnavailableError(message);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function completedSuggestion(
  payload: OpenAiResponsesPayload,
  fallbackModel: string,
  dependencies: SuggestionDependencies,
): ConsultantKnowledgeSuggestionResult {
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
      model: payload.model ?? fallbackModel,
      generatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
      usage: {
        inputTokens: payload.usage?.input_tokens ?? null,
        outputTokens: payload.usage?.output_tokens ?? null,
        totalTokens: payload.usage?.total_tokens ?? null,
      },
    },
  };
}

export async function generateConsultantKnowledgeSuggestion(
  params: {
    service: ConsultantCatalogService;
    currentContent?: ConsultantKnowledgeContent;
    actorId: string;
  },
  dependencies: SuggestionDependencies = {},
): Promise<ConsultantKnowledgeSuggestionResult> {
  const apiKey = apiKeyFrom(dependencies);
  const model = dependencies.model ?? env.OPENAI_CONSULTANT_KNOWLEDGE_MODEL;
  const payload = await requestOpenAi({
    endpoint: openAiEndpoint(dependencies),
    apiKey,
    method: "POST",
    body: openAiRequestBody(params, dependencies, false),
    dependencies,
  });
  return completedSuggestion(payload, model, dependencies);
}

export async function startConsultantKnowledgeSuggestion(
  params: {
    service: ConsultantCatalogService;
    currentContent?: ConsultantKnowledgeContent;
    actorId: string;
  },
  dependencies: SuggestionDependencies = {},
): Promise<ConsultantKnowledgeSuggestionProgress> {
  const apiKey = apiKeyFrom(dependencies);
  const model = dependencies.model ?? env.OPENAI_CONSULTANT_KNOWLEDGE_MODEL;
  const payload = await requestOpenAi({
    endpoint: openAiEndpoint(dependencies),
    apiKey,
    method: "POST",
    body: openAiRequestBody(params, dependencies, true),
    dependencies,
  });

  if (payload.status === "completed") {
    return {
      status: "completed",
      suggestion: completedSuggestion(payload, model, dependencies),
    };
  }

  if ((payload.status === "queued" || payload.status === "in_progress") && payload.id) {
    return {
      status: payload.status,
      job: {
        responseId: payload.id,
        jobToken: consultantSuggestionJobToken({
          apiKey,
          actorId: params.actorId,
          serviceId: params.service.serviceId,
          responseId: payload.id,
        }),
        model: payload.model ?? model,
      },
    };
  }

  throw new ConsultantKnowledgeSuggestionUnavailableError(
    "GPT-5.6 returned an unexpected generation status. No knowledge was changed.",
  );
}

export async function pollConsultantKnowledgeSuggestion(
  params: {
    serviceId: string;
    responseId: string;
    jobToken: string;
    actorId: string;
  },
  dependencies: SuggestionDependencies = {},
): Promise<ConsultantKnowledgeSuggestionProgress> {
  const apiKey = apiKeyFrom(dependencies);
  if (!isValidJobToken({ apiKey, ...params })) {
    throw new ConsultantKnowledgeSuggestionUnavailableError(
      "This GPT-5.6 draft job is invalid or belongs to another session.",
    );
  }

  const model = dependencies.model ?? env.OPENAI_CONSULTANT_KNOWLEDGE_MODEL;
  const payload = await requestOpenAi({
    endpoint: openAiEndpoint(dependencies, params.responseId),
    apiKey,
    method: "GET",
    dependencies,
  });

  if (payload.status === "completed") {
    return {
      status: "completed",
      suggestion: completedSuggestion(payload, model, dependencies),
    };
  }

  if (payload.status === "queued" || payload.status === "in_progress") {
    return {
      status: payload.status,
      job: {
        responseId: params.responseId,
        jobToken: params.jobToken,
        model: payload.model ?? model,
      },
    };
  }

  throw new ConsultantKnowledgeSuggestionUnavailableError(
    "GPT-5.6 stopped before completing the draft. No knowledge was changed.",
  );
}

export const __test = {
  CONSULTANT_KNOWLEDGE_INSTRUCTIONS,
  responseText,
};
