import { z } from "zod";
import { env } from "../../config/env.js";
import { runWithAnalyticsQueryContext } from "../analytics-query-context.js";
import { sanitizeError, nowIso } from "./safety.js";
import type { AgentToolDefinition, AgentToolInput, AgentToolResult, GreatTimeAgentId } from "./types.js";

export function assertToolAllowed(params: {
  requestedToolName: string;
  agentId: GreatTimeAgentId;
  registry: Map<string, AgentToolDefinition>;
}) {
  const tool = params.registry.get(params.requestedToolName);

  if (!tool || tool.agentId !== params.agentId) {
    throw new Error(`Tool ${params.requestedToolName} is not allowed for ${params.agentId}.`);
  }

  if (env.AGENT_HUB_READ_ONLY_MODE && tool.capability !== "read_only") {
    throw new Error("Tool is not available in read-only Agent Hub mode.");
  }

  return tool;
}

async function executeWithTimeout(tool: AgentToolDefinition, input: AgentToolInput) {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  return Promise.race([
    tool.execute(input),
    new Promise<AgentToolResult>((resolve) => {
      timeoutHandle = setTimeout(() => {
        resolve({
          toolName: tool.name,
          sourceName: tool.sourceName,
          checkedAt: nowIso(),
          period: input.period.label,
          dataStatus: "unavailable",
          live: tool.live,
          timedOut: true,
          errorCategory: "timeout",
          warnings: [
            {
              type: "timeout",
              title: "Source timeout",
              message: `${tool.description} timed out before returning data.`,
            },
          ],
        });
      }, tool.timeoutMs);
    }),
  ]).finally(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  });
}

function categorizeToolError(error: unknown) {
  if (error instanceof z.ZodError) {
    return "invalid_tool_input";
  }

  const message = sanitizeError(error).toLowerCase();
  if (message.includes("read-only")) {
    return "read_only_blocked";
  }
  if (message.includes("timed out") || message.includes("timeout")) {
    return "timeout";
  }

  return "tool_unavailable";
}

function addToolMetadata(result: AgentToolResult, startedAt: number): AgentToolResult {
  const latencyMs = Date.now() - startedAt;
  const warningTypes = new Set((result.warnings ?? []).map((warning) => warning.type));
  const timedOut = result.timedOut === true || warningTypes.has("timeout");
  const errorCategory =
    result.errorCategory ??
    (timedOut
      ? "timeout"
      : result.dataStatus === "unavailable"
        ? warningTypes.has("invalid_tool_input")
          ? "invalid_tool_input"
          : warningTypes.has("tool_unavailable")
            ? "tool_unavailable"
            : "source_unavailable"
        : undefined);

  return {
    ...result,
    latencyMs,
    timedOut,
    ...(errorCategory ? { errorCategory } : {}),
  };
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  maxConcurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(maxConcurrency)));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }),
  );

  return results;
}

async function executeSingleTool(params: {
  toolName: string;
  agentId: GreatTimeAgentId;
  input: AgentToolInput;
  registry: Map<string, AgentToolDefinition>;
}) {
  const startedAt = Date.now();

  try {
    const tool = assertToolAllowed({
      requestedToolName: params.toolName,
      agentId: params.agentId,
      registry: params.registry,
    });
    tool.inputSchema.parse(params.input);
    const result = await runWithAnalyticsQueryContext(
      {
        queryNamePrefix: `agent.${params.agentId}.${tool.name}`,
        labels: {
          app: "greattime",
          feature: "agent_hub",
          agent: params.agentId,
          tool: tool.name,
        },
        timeoutMs: env.AGENT_BIGQUERY_TIMEOUT_MS,
        ttlMs: env.BQ_QUERY_DEFAULT_TTL_MS,
        readOnly: true,
      },
      () => executeWithTimeout(tool, params.input),
    );

    return addToolMetadata(result, startedAt);
  } catch (error) {
    const errorCategory = categorizeToolError(error);
    return addToolMetadata({
      toolName: params.toolName,
      sourceName: params.registry.get(params.toolName)?.sourceName ?? "GreatTime source",
      checkedAt: nowIso(),
      period: params.input.period.label,
      dataStatus: "unavailable",
      live: params.registry.get(params.toolName)?.live,
      timedOut: errorCategory === "timeout",
      errorCategory,
      warnings: [
        {
          type: error instanceof z.ZodError ? "invalid_tool_input" : "tool_unavailable",
          title: "Source unavailable",
          message: sanitizeError(error),
        },
      ],
    } satisfies AgentToolResult, startedAt);
  }
}

export async function executeToolPlan(params: {
  toolNames: string[];
  agentId: GreatTimeAgentId;
  input: AgentToolInput;
  registry: Map<string, AgentToolDefinition>;
  maxConcurrency?: number;
}) {
  return mapWithConcurrency(params.toolNames, params.maxConcurrency ?? env.AGENT_TOOL_MAX_CONCURRENCY, (toolName) =>
    executeSingleTool({
      toolName,
      agentId: params.agentId,
      input: params.input,
      registry: params.registry,
    }),
  );
}
