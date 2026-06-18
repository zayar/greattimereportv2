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
  rating: z.enum(["helpful", "not_helpful"]),
  note: z.string().max(1000).nullable().optional(),
  outcome: z.enum(["messaged", "replied", "booked", "no_reply", "not_interested"]).nullable().optional(),
});

export const agentSessionParamsSchema = z.object({
  sessionId: z.string().min(1),
});

export const agentLearningTickSchema = z.object({
  clinicIds: z.array(z.string().min(1)).max(100).optional(),
  clinicCodesById: z.record(z.string()).optional(),
  jobTypes: z
    .array(
      z.enum([
        "customer_profiles",
        "finance_daily_snapshot",
        "service_practitioner_profiles",
        "appointment_daily_profile",
        "feedback_learning",
        "owner_insight_cards",
      ]),
    )
    .max(10)
    .optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
