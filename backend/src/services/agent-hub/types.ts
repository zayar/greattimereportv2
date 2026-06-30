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

export type AgentSourceScope = "live" | "historical" | "learned" | "cache";

export type GreatTimeAgentEntityType = "customer" | "appointment" | "service" | "practitioner" | "invoice";

export type GreatTimeAgentEntityContext = {
  entityType: GreatTimeAgentEntityType;
  entityId: string;
  displayName?: string;
  customerKey?: string;
  customerName?: string;
  customerPhone?: string;
  customerPhoneMasked?: string;
  memberId?: string;
  appointmentId?: string;
  appointmentTime?: string;
  appointmentStatus?: string;
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

export type GreatTimeAgentTableColumn = {
  key: string;
  title: string;
  unit?: "amount" | "count" | "percent" | "text";
  pii?: "phone" | "id" | "none";
  exportable?: boolean;
};

export type GreatTimeAgentTable = {
  title: string;
  columns: GreatTimeAgentTableColumn[];
  rows: Array<Record<string, unknown>>;
};

export type GreatTimeAgentRecommendation = {
  recommendationId?: string;
  recommendationType?: string;
  opportunityKey?: string;
  targetCustomerKey?: string;
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
  scope?: AgentSourceScope;
  dateRange?: {
    fromDate: string;
    toDate: string;
    timezone?: string;
  };
};

export type GreatTimeAgentWarning = {
  type: string;
  title: string;
  message: string;
};

export type Customer360PackageStatus = "active" | "low_remaining" | "completed" | "unknown";

export type Customer360FactPack = {
  identity: {
    customerKey: string;
    memberId?: string;
    displayName: string;
    joinedDate?: string | null;
    phoneNumber?: string;
    maskedPhone?: string;
    detailPath?: string;
  };
  value: {
    lifetimeSpend?: number;
    totalVisits?: number;
    averageVisitSpend?: number;
  };
  latestActivity: {
    lastVisitAt?: string | null;
    lastService?: string | null;
    lastTherapist?: string | null;
    daysSinceLastVisit?: number | null;
  };
  preferences: {
    preferredService?: string | null;
    preferredServiceCategory?: string | null;
    preferredTherapist?: string | null;
    preferredTherapistVisits?: number;
  };
  visitPattern: {
    averageVisitIntervalDays?: number | null;
    recentWindowVisits?: number;
    previousWindowVisits?: number;
    momentum?: "increasing" | "stable" | "declining" | "unknown";
  };
  packages: {
    purchaseCount?: number;
    activeHoldingCount?: number;
    totalRemainingSessions?: number;
    dataStatus: AgentDataStatus;
    holdings: Array<{
      packageId?: string;
      packageName?: string | null;
      serviceName: string;
      totalSessions?: number;
      usedSessions?: number;
      remainingSessions?: number;
      latestUsageDate?: string | null;
      latestTherapist?: string | null;
      status: Customer360PackageStatus;
    }>;
  };
  appointments: {
    current?: Array<Record<string, unknown>>;
    upcoming?: Array<Record<string, unknown>>;
    recentCompleted?: Array<Record<string, unknown>>;
  };
  payments: {
    selectedPeriodTotal?: number;
    invoiceCount?: number;
    averageInvoice?: number;
    outstanding?: number;
    preferredMethod?: string | null;
    recentInvoices: Array<Record<string, unknown>>;
  };
  usage: {
    selectedYear?: number;
    distinctServices?: number;
    topServices: Array<Record<string, unknown>>;
    monthlyServiceUsage: Array<Record<string, unknown>>;
  };
  recommendation?: {
    title: string;
    reasonCodes: string[];
    evidence: string[];
  };
  dataQuality: Array<{
    code: string;
    severity: "info" | "warning" | "blocking";
    message: string;
  }>;
  sources: GreatTimeAgentSource[];
};

export type Service360FactPack = {
  identity: {
    serviceKey: string;
    displayName: string;
    category: string;
    detailPath?: string;
    fromDate: string;
    toDate: string;
    selectedYear?: number;
    lastCompletedAt?: string | null;
  };
  performance: {
    revenue: number;
    paidLineCount: number;
    invoiceCount: number;
    completedBookingCount: number;
    customersServed: number;
    payingCustomers: number;
    customersTouched: number;
    repeatCustomerCount: number;
    repeatRatePct: number;
    averageSellingPrice: number;
    revenuePerCustomer: number;
    revenueGrowthPct: number;
    completedBookingGrowthPct: number;
  };
  demandPattern: {
    trend: Array<Record<string, unknown>>;
    peakWeekdays: Array<Record<string, unknown>>;
    peakHours: Array<Record<string, unknown>>;
  };
  therapists: {
    topAttributedTherapist?: string | null;
    topAttributedTherapistSharePct: number;
    unattributedBookingCount: number;
    unattributedBookingSharePct: number;
    performanceRows: Array<Record<string, unknown>>;
  };
  customers: {
    topRows: Array<Record<string, unknown>>;
  };
  affinities: {
    boughtTogether: Array<Record<string, unknown>>;
    alsoUsedBySameCustomers: Array<Record<string, unknown>>;
  };
  commercial: {
    packageMixPct: number;
    oneOffMixPct: number;
    averageDiscountRate: number;
    paymentMethodMix: Array<Record<string, unknown>>;
    packageBalanceStatus: "not_reported" | "partial" | "reliable";
  };
  recommendation?: {
    title: string;
    reasonCodes: string[];
    evidence: string[];
  };
  dataQuality: Array<{
    code: string;
    severity: "info" | "warning" | "blocking";
    message: string;
  }>;
  sources: GreatTimeAgentSource[];
};

export type GreatTimeAgentChatResponse = {
  sessionId: string;
  requestId: string;
  responseId: string;
  requestedAgent: GreatTimeRequestedAgentId;
  resolvedAgent: GreatTimeAgentId;
  autoMode: boolean;
  intent: string;
  period: AgentPeriod;
  assistantMessage: string;
  summary?: string;
  metrics?: GreatTimeAgentMetric[];
  tables?: GreatTimeAgentTable[];
  recommendations?: GreatTimeAgentRecommendation[];
  followUpQuestions?: string[];
  usedMemoryIds?: string[];
  data?: Record<string, unknown>;
  customer360?: Customer360FactPack;
  service360?: Service360FactPack;
  sources: GreatTimeAgentSource[];
  dataStatus: AgentDataStatus;
  warnings?: GreatTimeAgentWarning[];
  entityContext?: GreatTimeAgentEntityContext;
  entityRefs?: GreatTimeAgentEntityContext[];
  actions: Array<{ type: "read_only_agent_response"; detail?: string }>;
};

export type AgentRequestContext = {
  userId: string;
  userEmail?: string;
  authorizationHeader?: string;
  channel?: "web" | "telegram" | "system" | "unknown";
  telegramChatIdHash?: string | null;
  telegramUserIdHash?: string | null;
  telegramMessageId?: string | null;
  telegramCallbackDataType?: string | null;
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
  freshnessSeconds?: number;
  latencyMs?: number;
  timedOut?: boolean;
  errorCategory?: string;
  metrics?: GreatTimeAgentMetric[];
  tables?: GreatTimeAgentTable[];
  recommendations?: GreatTimeAgentRecommendation[];
  warnings?: GreatTimeAgentWarning[];
  summary?: string;
  data?: Record<string, unknown>;
  entityRefs?: GreatTimeAgentEntityContext[];
  sources?: GreatTimeAgentSource[];
  customer360?: Customer360FactPack;
  service360?: Service360FactPack;
};

export type AgentToolDefinition = {
  name: string;
  agentId: GreatTimeAgentId;
  description: string;
  inputSchema: z.ZodTypeAny;
  sourceName: string;
  capability?: "read_only" | "agent_metadata_write" | "approved_action_draft";
  live: boolean;
  maxRows: number;
  timeoutMs: number;
  execute: (input: AgentToolInput) => Promise<AgentToolResult>;
};

export type AgentRunTrace = {
  runId?: string;
  clinicId: string;
  clinicCode?: string | null;
  clinicName?: string | null;
  userId: string;
  userEmail?: string | null;
  sessionId: string;
  requestId: string;
  responseId: string;
  status?:
    | "queued"
    | "running"
    | "planning"
    | "calling_tools"
    | "generating_response"
    | "sending_response"
    | "completed"
    | "failed"
    | "timeout"
    | "cancelled";
  currentStep?: string | null;
  channel?: "web" | "telegram" | "system" | "unknown";
  telegramChatIdHash?: string | null;
  telegramUserIdHash?: string | null;
  telegramMessageId?: string | null;
  telegramCallbackDataType?: string | null;
  telegramDeliveryStatus?: string | null;
  telegramDeliveryLatencyMs?: number | null;
  callbackExpired?: boolean;
  callbackResolved?: boolean;
  buttonCount?: number;
  messageLength?: number;
  questionPreview?: string | null;
  answerPreview?: string | null;
  requestedAgent?: GreatTimeRequestedAgentId;
  resolvedAgent?: GreatTimeAgentId;
  intent?: string;
  toolNames?: string[];
  sourceStatuses?: AgentDataStatus[];
  dataStatus?: AgentDataStatus;
  fallbackUsed?: boolean;
  narrativeFallbackUsed?: boolean;
  narrativeSkipped?: boolean;
  narrativeCacheHit?: boolean;
  deterministicResponseUsed?: boolean;
  usedMemoryIds?: string[];
  totalLatencyMs?: number;
  planningLatencyMs?: number;
  memoryLatencyMs?: number;
  toolLatencyMs?: number;
  narrativeLatencyMs?: number;
  persistenceLatencyMs?: number;
  cacheStats?: {
    bigQueryHits?: number;
    bigQueryMisses?: number;
  };
  sourceDurations?: Array<{
    toolName: string;
    durationMs: number;
    dataStatus: AgentDataStatus;
    timedOut?: boolean;
    errorCategory?: string;
  }>;
  toolExecutionResults?: Array<{
    toolName: string;
    latencyMs: number;
    timedOut: boolean;
    dataStatus: AgentDataStatus;
    errorCategory?: string;
  }>;
  tools?: Array<{
    toolName: string;
    status: "started" | "completed" | "failed" | "timeout";
    startedAt?: string | null;
    completedAt?: string | null;
    latencyMs?: number | null;
    dataStatus?: AgentDataStatus | null;
    errorCategory?: string | null;
    errorMessage?: string | null;
  }>;
  timedOutTools?: string[];
  unavailableTools?: string[];
  model?: string | null;
  provider?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  estimatedCostUsd?: number | null;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string | null;
  errorCategory?: string | null;
  sanitizedError?: string;
  warnings?: string[];
  timeline?: Array<{
    label: string;
    status: string;
    at: string;
    detail?: string | null;
  }>;
};

export type AgentFeedbackInput = {
  clinicId: string;
  sessionId: string;
  responseId: string;
  requestId?: string | null;
  recommendationId?: string | null;
  recommendationType?: string | null;
  opportunityKey?: string | null;
  targetCustomerKey?: string | null;
  feedbackType?:
    | "helpful"
    | "not_helpful"
    | "wrong_data"
    | "too_long"
    | "too_short"
    | "remember_this"
    | "correction";
  rating: "helpful" | "not_helpful";
  note?: string | null;
  outcome?:
    | "shown"
    | "accepted"
    | "dismissed"
    | "contacted"
    | "messaged"
    | "replied"
    | "booked"
    | "paid"
    | "visited"
    | "no_reply"
    | "not_interested"
    | "remind_later"
    | "failed"
    | null;
  resolvedAgent?: GreatTimeAgentId | null;
  intent?: string | null;
  sourceTools?: string[];
  usedMemoryIds?: string[];
};
