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

export type AgentSourceScope = "live" | "historical" | "learned";

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
  recommendationId?: string;
  recommendationType?: string;
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
  assistantMessage: string;
  summary?: string;
  metrics?: GreatTimeAgentMetric[];
  tables?: GreatTimeAgentTable[];
  recommendations?: GreatTimeAgentRecommendation[];
  followUpQuestions?: string[];
  usedMemoryIds?: string[];
  customer360?: Customer360FactPack;
  service360?: Service360FactPack;
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
  usedMemoryIds?: string[];
  createdAt: string;
  sanitizedError?: string;
};

export type AgentFeedbackInput = {
  clinicId: string;
  sessionId: string;
  responseId: string;
  requestId?: string | null;
  recommendationId?: string | null;
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
};
