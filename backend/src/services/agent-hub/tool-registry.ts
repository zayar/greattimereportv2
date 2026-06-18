import { createAppointmentTools } from "./tools/appointment.tools.js";
import { createBusinessTools } from "./tools/business.tools.js";
import { createCustomerTools } from "./tools/customer.tools.js";
import { createFinanceTools } from "./tools/finance.tools.js";
import type { AgentToolDefinition, GreatTimeAgentId } from "./types.js";

export function createAgentToolRegistry() {
  const tools = [
    ...createFinanceTools(),
    ...createCustomerTools(),
    ...createBusinessTools(),
    ...createAppointmentTools(),
  ];

  return new Map(tools.map((tool) => [tool.name, tool]));
}

export function getAgentToolAllowlist(agentId: GreatTimeAgentId, registry = createAgentToolRegistry()) {
  return [...registry.values()].filter((tool) => tool.agentId === agentId).map((tool) => tool.name);
}

export function getToolDefinition(name: string, registry = createAgentToolRegistry()): AgentToolDefinition | null {
  return registry.get(name) ?? null;
}
