import { z } from "zod";
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
  return Promise.race([
    tool.execute(input),
    new Promise<AgentToolResult>((resolve) => {
      setTimeout(() => {
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
  ]);
}

export async function executeToolPlan(params: {
  toolNames: string[];
  agentId: GreatTimeAgentId;
  input: AgentToolInput;
  registry: Map<string, AgentToolDefinition>;
}) {
  const results: AgentToolResult[] = [];

  for (const toolName of params.toolNames) {
    try {
      const tool = assertToolAllowed({
        requestedToolName: toolName,
        agentId: params.agentId,
        registry: params.registry,
      });
      tool.inputSchema.parse(params.input);
      results.push(await executeWithTimeout(tool, params.input));
    } catch (error) {
      results.push({
        toolName,
        sourceName: params.registry.get(toolName)?.sourceName ?? "GreatTime source",
        checkedAt: nowIso(),
        period: params.input.period.label,
        dataStatus: "unavailable",
        live: params.registry.get(toolName)?.live,
        warnings: [
          {
            type: error instanceof z.ZodError ? "invalid_tool_input" : "tool_unavailable",
            title: "Source unavailable",
            message: sanitizeError(error),
          },
        ],
      });
    }
  }

  return results;
}
