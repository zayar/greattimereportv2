import { z } from "zod";

export const greatTimeAgentIds = ["finance", "customer_relationship", "business", "appointment"] as const;
export const greatTimeRequestedAgentIds = ["auto", ...greatTimeAgentIds] as const;

export const agentEntityContextSchema = z.object({
  entityType: z.enum(["customer", "appointment", "service", "practitioner", "invoice"]),
  entityId: z.string().min(1),
  displayName: z.string().optional(),
  customerKey: z.string().optional(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  memberId: z.string().optional(),
  appointmentId: z.string().optional(),
  serviceName: z.string().optional(),
  practitionerName: z.string().optional(),
  invoiceNumber: z.string().optional(),
  sourceResponseId: z.string().optional(),
  rank: z.number().int().positive().optional(),
});

export const agentChatRequestSchema = z.object({
  sessionId: z.string().min(1).optional(),
  clinicId: z.string().min(1),
  clinicCode: z.string().min(1).optional(),
  agent: z.enum(greatTimeRequestedAgentIds).default("auto"),
  message: z.string().trim().min(1).max(1000),
  aiLanguage: z.enum(["en", "my", "en-US", "my-MM"]).optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timezone: z.string().min(1).max(80).optional(),
  requestId: z.string().min(1).max(120).optional(),
  entityContext: agentEntityContextSchema.optional(),
});

export const agentFeedbackSchema = z.object({
  clinicId: z.string().min(1),
  sessionId: z.string().min(1),
  responseId: z.string().min(1),
  requestId: z.string().min(1).nullable().optional(),
  recommendationId: z.string().min(1).nullable().optional(),
  recommendationType: z.string().min(1).max(120).nullable().optional(),
  opportunityKey: z.string().min(1).max(200).nullable().optional(),
  targetCustomerKey: z.string().min(1).max(200).nullable().optional(),
  feedbackType: z
    .enum(["helpful", "not_helpful", "wrong_data", "too_long", "too_short", "remember_this", "correction"])
    .optional(),
  rating: z.enum(["helpful", "not_helpful"]),
  note: z.string().max(1000).nullable().optional(),
  outcome: z
    .enum([
      "shown",
      "accepted",
      "dismissed",
      "contacted",
      "messaged",
      "replied",
      "booked",
      "paid",
      "visited",
      "no_reply",
      "not_interested",
      "remind_later",
      "failed",
    ])
    .nullable()
    .optional(),
  resolvedAgent: z.enum(greatTimeAgentIds).nullable().optional(),
  intent: z.string().min(1).max(120).nullable().optional(),
  sourceTools: z.array(z.string().min(1).max(120)).max(20).optional(),
  usedMemoryIds: z.array(z.string().min(1).max(160)).max(20).optional(),
});

export const agentSessionParamsSchema = z.object({
  sessionId: z.string().min(1),
});

const agentLearningJobTypes = [
  "customer_profiles",
  "finance_daily_snapshot",
  "service_profiles",
  "practitioner_profiles",
  "service_practitioner_profiles",
  "appointment_operational_snapshot",
  "appointment_daily_profile",
  "feedback_learning",
  "recommendation_outcome_observer",
  "owner_insight_cards",
  "weekly_business_review",
  "memory_maintenance",
] as const;

export const agentLearningTickSchema = z.object({
  clinicIds: z.array(z.string().min(1)).max(100).optional(),
  clinicCodesById: z.record(z.string()).optional(),
  jobTypes: z.array(z.enum(agentLearningJobTypes)).max(12).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  runAt: z.string().datetime().optional(),
  timezone: z.string().min(1).max(80).optional(),
  dryRun: z.boolean().optional(),
  operationalIntervalMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
});

export const agentLearningRunAllSchema = z.object({
  clinicIds: z.array(z.string().min(1)).max(100).optional(),
  jobTypes: z.array(z.enum(agentLearningJobTypes)).max(12).optional(),
  dryRun: z.boolean().optional(),
});
