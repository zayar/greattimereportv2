import type { z } from "zod";

export type GreatTimeAgentId = "finance" | "customer_relationship" | "business" | "appointment";
export type GreatTimeRequestedAgentId = GreatTimeAgentId | "auto";

export type AgentDataStatus =
  | "ok"
  | "partial"
  | "no_activity"
  | "not_found"
  | "unavailable"
  | "not_ready"
  | "stale";

export type GreatTimeAgentEntityType = "customer" | "appointment" | "service" | "practitioner" | "invoice";

export type GreatTimeAgentEntityContext = {
  entityType: GreatTimeAgentEntityType;
  entityId: string;
  displayName?: string;
  customerKey?: string;
  customerName?: string;
  customerPhone?: string;
  memberId?: string;
  appointmentId?: string;
  serviceName?: string;
  practitionerName?: string;
  invoiceNumber?: string;
  sourceResponseId?: string;
  rank?: number;
};

export type GreatTimeAgentChatRequest = {
  sessionId?: string;
  clinicId: string;
  clinicCode?: string;
  agent?: GreatTimeRequestedAgentId;
  message: string;
  aiLanguage?: "en" | "my" | "en-US" | "my-MM";
  fromDate?: string;
  toDate?: string;
  timezone?: string;
  requestId?: string;
  entityContext?: GreatTimeAgentEntityContext;
};

export type GreatTimeAgentMetric = {
  label: string;
  value: string | number;
  unit?: string;
  helperText?: string;
};

export type GreatTimeAgentTable = {
  title: string;
  columns: Array<{ key: string; title: string }>;
  rows: Array<Record<string, unknown>>;
};

export type GreatTimeAgentRecommendation = {
  title?: string;
  message: string;
  sourceTools: string[];
};

export type GreatTimeAgentSource = {
  tool: string;
  sourceName: string;
  checkedAt: string;
  period?: string;
  dataStatus: AgentDataStatus;
  freshnessSeconds?: number;
  live?: boolean;
};

export type GreatTimeAgentWarning = {
  type: string;
  title: string;
  message: string;
};

export type GreatTimeAgentChatResponse = {
  sessionId: string;
  requestId: string;
  responseId: string;
  requestedAgent: GreatTimeRequestedAgentId;
  resolvedAgent: GreatTimeAgentId;
  autoMode: boolean;
  intent: string;
  assistantMessage: string;
  summary?: string;
  metrics?: GreatTimeAgentMetric[];
  tables?: GreatTimeAgentTable[];
  recommendations?: GreatTimeAgentRecommendation[];
  followUpQuestions?: string[];
  sources: GreatTimeAgentSource[];
  dataStatus: AgentDataStatus;
  warnings?: GreatTimeAgentWarning[];
  entityContext?: GreatTimeAgentEntityContext;
  actions: Array<{ type: "read_only_agent_response"; detail?: string }>;
};

export type AgentRequestContext = {
  userId: string;
  userEmail?: string;
  authorizationHeader?: string;
};

export type AgentClinicContext = {
  clinicId: string;
  clinicCode: string;
};

export type AgentPeriod = {
  fromDate: string;
  toDate: string;
  label: string;
  previousFromDate?: string;
  previousToDate?: string;
};

export type GreatTimeAgentIntentPlan = {
  requestedAgent: GreatTimeRequestedAgentId;
  resolvedAgent: GreatTimeAgentId;
  autoMode: boolean;
  intent: string;
  toolNames: string[];
  period: AgentPeriod;
  unsupportedReason?: string;
  warnings?: GreatTimeAgentWarning[];
};

export type AgentToolInput = {
  request: GreatTimeAgentChatRequest;
  clinic: AgentClinicContext;
  period: AgentPeriod;
  intent: string;
  entityContext?: GreatTimeAgentEntityContext;
  requestContext: AgentRequestContext;
};

export type AgentToolResult = {
  toolName: string;
  sourceName: string;
  checkedAt: string;
  period?: string;
  dataStatus: AgentDataStatus;
  live?: boolean;
  metrics?: GreatTimeAgentMetric[];
  tables?: GreatTimeAgentTable[];
  recommendations?: GreatTimeAgentRecommendation[];
  warnings?: GreatTimeAgentWarning[];
  summary?: string;
  entityRefs?: GreatTimeAgentEntityContext[];
};

export type AgentToolDefinition = {
  name: string;
  agentId: GreatTimeAgentId;
  description: string;
  inputSchema: z.ZodTypeAny;
  sourceName: string;
  live: boolean;
  maxRows: number;
  timeoutMs: number;
  execute: (input: AgentToolInput) => Promise<AgentToolResult>;
};

export type AgentRunTrace = {
  clinicId: string;
  userId: string;
  sessionId: string;
  requestId: string;
  responseId: string;
  requestedAgent: GreatTimeRequestedAgentId;
  resolvedAgent: GreatTimeAgentId;
  intent: string;
  toolNames: string[];
  sourceStatuses: AgentDataStatus[];
  dataStatus: AgentDataStatus;
  fallbackUsed: boolean;
  createdAt: string;
  sanitizedError?: string;
};

export type AgentFeedbackInput = {
  clinicId: string;
  sessionId: string;
  responseId: string;
  rating: "helpful" | "not_helpful";
  note?: string | null;
  outcome?: "messaged" | "replied" | "booked" | "no_reply" | "not_interested" | null;
};
