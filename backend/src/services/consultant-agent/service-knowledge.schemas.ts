import { z } from "zod";

const shortText = z.string().trim().min(1).max(240);
const knowledgeList = z.array(shortText).max(40);

export const consultantKnowledgeLocaleSchema = z.object({
  overview: z.string().trim().max(2_000),
  serviceAliases: knowledgeList,
  concerns: knowledgeList,
  suitableFor: knowledgeList,
  notSuitableFor: knowledgeList,
  benefits: knowledgeList,
  limitations: knowledgeList,
  preparation: knowledgeList,
  aftercare: knowledgeList,
  expectedResults: knowledgeList,
  consultationQuestions: knowledgeList,
  escalationRules: knowledgeList,
});

export const consultantKnowledgeContentSchema = z.object({
  en: consultantKnowledgeLocaleSchema,
  my: consultantKnowledgeLocaleSchema,
});

export const consultantServiceKnowledgeSchema = z.object({
  id: z.string().min(1),
  clinicId: z.string().min(1),
  clinicCode: z.string().min(1),
  serviceId: z.string().min(1),
  serviceName: z.string().min(1),
  content: consultantKnowledgeContentSchema,
  publishedContent: consultantKnowledgeContentSchema.nullable(),
  status: z.enum(["draft", "published", "archived"]),
  version: z.number().int().positive(),
  publishedVersion: z.number().int().positive().nullable(),
  createdAt: z.string().datetime(),
  createdBy: z.string().min(1),
  createdByEmail: z.string().nullable(),
  updatedAt: z.string().datetime(),
  updatedBy: z.string().min(1),
  updatedByEmail: z.string().nullable(),
  publishedAt: z.string().datetime().nullable(),
  publishedBy: z.string().nullable(),
  publishedByEmail: z.string().nullable(),
});

export const consultantKnowledgeClinicQuerySchema = z.object({
  clinicId: z.string().min(1),
  clinicCode: z.string().min(1).optional(),
});

export const consultantKnowledgeServiceParamsSchema = z.object({
  serviceId: z.string().min(1).max(160),
});

export const saveConsultantKnowledgeDraftSchema = z.object({
  clinicId: z.string().min(1),
  clinicCode: z.string().min(1).optional(),
  content: consultantKnowledgeContentSchema,
  expectedVersion: z.number().int().positive().nullable().optional(),
});

export const publishConsultantKnowledgeSchema = z.object({
  clinicId: z.string().min(1),
  clinicCode: z.string().min(1).optional(),
  expectedVersion: z.number().int().positive(),
});

export const suggestConsultantKnowledgeSchema = z.object({
  clinicId: z.string().min(1),
  clinicCode: z.string().min(1).optional(),
  currentContent: consultantKnowledgeContentSchema.optional(),
});

export const consultantKnowledgeSuggestionSchema = z.object({
  content: consultantKnowledgeContentSchema,
  confidence: z.enum(["low", "medium", "high"]),
  warnings: z.array(shortText).max(20),
  missingInformation: z.array(shortText).max(20),
  reviewNotes: z.array(shortText).max(20),
});

export type ConsultantKnowledgeLocale = z.infer<typeof consultantKnowledgeLocaleSchema>;
export type ConsultantKnowledgeContent = z.infer<typeof consultantKnowledgeContentSchema>;
export type ConsultantServiceKnowledge = z.infer<typeof consultantServiceKnowledgeSchema>;
export type ConsultantKnowledgeSuggestion = z.infer<typeof consultantKnowledgeSuggestionSchema>;

export function emptyConsultantKnowledgeLocale(): ConsultantKnowledgeLocale {
  return {
    overview: "",
    serviceAliases: [],
    concerns: [],
    suitableFor: [],
    notSuitableFor: [],
    benefits: [],
    limitations: [],
    preparation: [],
    aftercare: [],
    expectedResults: [],
    consultationQuestions: [],
    escalationRules: [],
  };
}

export function emptyConsultantKnowledgeContent(): ConsultantKnowledgeContent {
  return {
    en: emptyConsultantKnowledgeLocale(),
    my: emptyConsultantKnowledgeLocale(),
  };
}

export function isConsultantKnowledgeLocalePublishable(locale: ConsultantKnowledgeLocale) {
  const hasRecommendationBasis = locale.suitableFor.length > 0 || locale.benefits.length > 0;
  const hasSafetyBoundary =
    locale.notSuitableFor.length > 0 || locale.limitations.length > 0 || locale.escalationRules.length > 0;

  return Boolean(
    locale.overview &&
      locale.concerns.length > 0 &&
      hasRecommendationBasis &&
      hasSafetyBoundary &&
      locale.consultationQuestions.length > 0,
  );
}

export function isConsultantKnowledgePublishable(content: ConsultantKnowledgeContent) {
  return isConsultantKnowledgeLocalePublishable(content.en) || isConsultantKnowledgeLocalePublishable(content.my);
}
