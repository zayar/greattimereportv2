import { z } from "zod";
import { env } from "../../config/env.js";
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
  try {
    const tool = assertToolAllowed({
      requestedToolName: params.toolName,
      agentId: params.agentId,
      registry: params.registry,
    });
    tool.inputSchema.parse(params.input);
    return await executeWithTimeout(tool, params.input);
  } catch (error) {
    return {
      toolName: params.toolName,
      sourceName: params.registry.get(params.toolName)?.sourceName ?? "GreatTime source",
      checkedAt: nowIso(),
      period: params.input.period.label,
      dataStatus: "unavailable",
      live: params.registry.get(params.toolName)?.live,
      warnings: [
        {
          type: error instanceof z.ZodError ? "invalid_tool_input" : "tool_unavailable",
          title: "Source unavailable",
          message: sanitizeError(error),
        },
      ],
    } satisfies AgentToolResult;
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
