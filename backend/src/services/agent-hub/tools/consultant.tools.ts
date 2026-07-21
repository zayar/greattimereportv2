import { z } from "zod";
import { env } from "../../../config/env.js";
import { runWithAnalyticsQueryContext } from "../../analytics-query-context.js";
import { getServiceBehaviorReport } from "../../reports/service-behavior.service.js";
import { requireQueenConsultantClinic } from "../../consultant-agent/consultant-access.js";
import {
  getConsultantServiceCatalog,
  type ConsultantCatalogService,
} from "../../consultant-agent/service-catalog.service.js";
import { listConsultantServiceKnowledge } from "../../consultant-agent/service-knowledge.repository.js";
import type {
  ConsultantKnowledgeLocale,
  ConsultantServiceKnowledge,
} from "../../consultant-agent/service-knowledge.schemas.js";
import { limitRows, nowIso } from "../safety.js";
import type {
  AgentDataStatus,
  AgentToolDefinition,
  AgentToolInput,
  AgentToolResult,
  GreatTimeAgentWarning,
} from "../types.js";

const toolInputSchema = z.custom<AgentToolInput>(() => true);
const MAX_ADVICE_RESULTS = 3;
const MATCH_STOP_WORDS = new Set([
  "a",
  "about",
  "and",
  "are",
  "can",
  "do",
  "for",
  "have",
  "i",
  "is",
  "it",
  "me",
  "my",
  "of",
  "or",
  "please",
  "service",
  "services",
  "the",
  "to",
  "what",
  "which",
  "with",
  "you",
]);

const URGENT_CONCERN_PATTERN =
  /difficulty\s+breathing|trouble\s+breathing|severe\s+(?:pain|swelling|burn)|swollen\s+(?:eye|eyes|face|lips|tongue)|eye\s+(?:injury|burn)|large\s+blisters?|high\s+fever|faint(?:ing|ed)?|uncontrolled\s+bleeding|signs?\s+of\s+infection|pus|အရေးပေါ်|အသက်ရှူ(?:မဝ|ခက်)|သွေးမတိတ်|ဖျားကြီး/i;

function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTokens(value: string) {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((token) => token.length > 1 && !MATCH_STOP_WORDS.has(token)),
  );
}

function localeHasContent(locale: ConsultantKnowledgeLocale) {
  return Boolean(
    locale.overview ||
      locale.concerns.length ||
      locale.suitableFor.length ||
      locale.benefits.length ||
      locale.consultationQuestions.length,
  );
}

function preferredKnowledgeLocale(knowledge: ConsultantServiceKnowledge, language?: string) {
  const published = knowledge.publishedContent!;
  const wantsMyanmar = language === "my" || language === "my-MM";
  if (wantsMyanmar && localeHasContent(published.my)) {
    return published.my;
  }
  return localeHasContent(published.en) ? published.en : published.my;
}

function phraseScore(question: string, values: string[], points: number) {
  const normalizedQuestion = normalizeText(question);
  return values.reduce((score, value) => {
    const phrase = normalizeText(value);
    return score + (phrase.length > 1 && normalizedQuestion.includes(phrase) ? points : 0);
  }, 0);
}

function tokenOverlapScore(question: string, values: string[]) {
  const questionTokens = meaningfulTokens(question);
  if (questionTokens.size === 0) {
    return 0;
  }

  const valueTokens = meaningfulTokens(values.join(" "));
  const overlap = [...questionTokens].filter((token) => valueTokens.has(token)).length;
  return overlap >= 2 ? overlap : 0;
}

function unorderedPhraseScore(question: string, values: string[], points: number) {
  const questionTokens = meaningfulTokens(question);
  return values.reduce((score, value) => {
    const phraseTokens = meaningfulTokens(value);
    if (phraseTokens.size < 2) {
      return score;
    }

    return score + ([...phraseTokens].every((token) => questionTokens.has(token)) ? points : 0);
  }, 0);
}

export function rankConsultantKnowledge(params: {
  question: string;
  knowledge: ConsultantServiceKnowledge;
  language?: string;
}) {
  const locale = preferredKnowledgeLocale(params.knowledge, params.language);
  const question = normalizeText(params.question);
  const serviceName = normalizeText(params.knowledge.serviceName);
  const asksForCatalog = /what\s+services|available\s+services|service\s+menu|recommend\s+(?:a\s+)?service|ဘာဝန်ဆောင်မှု/i.test(
    params.question,
  );

  let score = serviceName && question.includes(serviceName) ? 40 : 0;
  score += phraseScore(params.question, locale.serviceAliases, 30);
  score += phraseScore(params.question, locale.concerns, 24);
  score += unorderedPhraseScore(params.question, locale.concerns, 18);
  score += phraseScore(params.question, locale.suitableFor, 12);
  score += Math.min(12, tokenOverlapScore(params.question, [
    ...locale.concerns,
    ...locale.suitableFor,
    ...locale.serviceAliases,
    locale.overview,
  ]) * 3);

  if (score === 0 && asksForCatalog) {
    score = 1;
  }

  return { score, locale };
}

export function containsUrgentConsultantConcern(message: string) {
  return URGENT_CONCERN_PATTERN.test(message);
}

function formatPrice(price: string | undefined) {
  if (!price) {
    return "Price unavailable";
  }

  const amount = Number(price);
  return Number.isFinite(amount) ? `${amount.toLocaleString("en-US")} MMK` : "Price unavailable";
}

function catalogById(catalog: ConsultantCatalogService[]) {
  return new Map(catalog.map((service) => [service.serviceId, service]));
}

function firstOrFallback(items: string[], fallback: string) {
  return items.find(Boolean) ?? fallback;
}

function buildAdviceMessage(params: {
  service: ConsultantCatalogService | undefined;
  locale: ConsultantKnowledgeLocale;
}) {
  const price = formatPrice(params.service?.price);
  const duration = params.service?.durationMinutes
    ? `${params.service.durationMinutes.toLocaleString("en-US")} minutes`
    : "duration unavailable";
  const why = firstOrFallback(
    [...params.locale.suitableFor, ...params.locale.benefits],
    params.locale.overview || params.service?.description || "This service matched the approved concern tags.",
  );
  const limitation = firstOrFallback(
    [...params.locale.notSuitableFor, ...params.locale.limitations],
    "Final suitability must be confirmed during a staff consultation.",
  );
  const preparation = params.locale.preparation[0];
  const aftercare = params.locale.aftercare[0];

  return [
    `${price}; ${duration}.`,
    `Why it may fit: ${why}`,
    `Important: ${limitation}`,
    preparation ? `Before: ${preparation}` : "",
    aftercare ? `Aftercare: ${aftercare}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function urgentConcernResult(input: AgentToolInput): AgentToolResult {
  const checkedAt = nowIso();
  return {
    toolName: "get_consultant_service_advice",
    sourceName: "GreatTime Consultant safety policy",
    checkedAt,
    dataStatus: "not_ready",
    live: false,
    summary:
      "I cannot recommend a cosmetic service for the symptoms described. Please seek prompt assessment from a qualified medical professional or urgent care. The Consultant does not diagnose medical conditions.",
    warnings: [
      {
        type: "consultant_medical_escalation",
        title: "Medical assessment recommended",
        message:
          "Possible urgent symptoms were mentioned, so service recommendations and pricing were intentionally withheld.",
      },
    ],
    sources: [
      {
        tool: "get_consultant_service_advice",
        sourceName: "GreatTime Consultant safety policy",
        checkedAt,
        dataStatus: "not_ready",
        live: false,
        scope: "learned",
      },
    ],
    data: { escalationRequired: true, question: input.request.message },
  };
}

async function getConsultantServiceAdvice(input: AgentToolInput): Promise<AgentToolResult> {
  requireQueenConsultantClinic(input.clinic);

  if (containsUrgentConsultantConcern(input.request.message)) {
    return urgentConcernResult(input);
  }

  const checkedAt = nowIso();
  const warnings: GreatTimeAgentWarning[] = [];
  const [knowledgeResult, catalogResult] = await Promise.allSettled([
    listConsultantServiceKnowledge({ clinicId: input.clinic.clinicId, publishedOnly: true }),
    getConsultantServiceCatalog({
      clinic: input.clinic,
      authorizationHeader: input.requestContext.authorizationHeader,
    }),
  ]);
  const knowledge = knowledgeResult.status === "fulfilled" ? knowledgeResult.value : [];
  const catalog = catalogResult.status === "fulfilled" ? catalogResult.value : [];

  if (knowledgeResult.status === "rejected") {
    warnings.push({
      type: "consultant_knowledge_unavailable",
      title: "Approved knowledge unavailable",
      message: "The Consultant knowledge source could not be read, so no service advice was generated.",
    });
  }
  if (catalogResult.status === "rejected") {
    warnings.push({
      type: "consultant_live_catalog_unavailable",
      title: "Live price unavailable",
      message: "GT API Core could not be read. Any matching approved guidance is shown without a current price.",
    });
  }

  const catalogMap = catalogById(catalog);
  const ranked = knowledge
    .map((item) => ({ item, ...rankConsultantKnowledge({
      question: input.request.message,
      knowledge: item,
      language: input.request.aiLanguage,
    }) }))
    .filter((match) => match.score > 0)
    .filter((match) => catalogResult.status === "rejected" || catalogMap.has(match.item.serviceId))
    .sort((left, right) => right.score - left.score || left.item.serviceName.localeCompare(right.item.serviceName))
    .slice(0, MAX_ADVICE_RESULTS);

  if (ranked.length === 0) {
    const normalizedQuestion = normalizeText(input.request.message);
    const namedCatalogService = catalog.find((service) => {
      const name = normalizeText(service.serviceName);
      return name.length > 2 && normalizedQuestion.includes(name);
    });

    if (namedCatalogService) {
      const description = namedCatalogService.description || "No service description is available in GT API Core.";
      return {
        toolName: "get_consultant_service_advice",
        sourceName: "GT API Core active service catalog",
        checkedAt,
        dataStatus: "partial",
        live: true,
        summary: `${namedCatalogService.serviceName} is an active service. Current price: ${formatPrice(namedCatalogService.price)}; duration: ${namedCatalogService.durationMinutes.toLocaleString("en-US")} minutes. API Core description: ${description} Consultation guidance has not been published in GT V2, so I cannot assess whether it suits a personal concern yet.`,
        tables: [{
          title: "Current service information",
          columns: [
            { key: "serviceName", title: "Service" },
            { key: "currentPrice", title: "Current price" },
            { key: "durationMinutes", title: "Minutes" },
            { key: "description", title: "API Core description" },
          ],
          rows: [{
            serviceId: namedCatalogService.serviceId,
            serviceName: namedCatalogService.serviceName,
            currentPrice: formatPrice(namedCatalogService.price),
            durationMinutes: namedCatalogService.durationMinutes,
            description,
          }],
        }],
        recommendations: [{
          recommendationType: "consultant_catalog_information",
          opportunityKey: namedCatalogService.serviceId,
          title: namedCatalogService.serviceName,
          message: `${description} Current price: ${formatPrice(namedCatalogService.price)}. Final suitability requires trained staff because approved consultation knowledge is not published yet.`,
          sourceTools: ["get_consultant_service_advice"],
        }],
        warnings: [{
          type: "consultant_knowledge_not_published",
          title: "Consultation knowledge not published",
          message: "Only the live API Core service facts are shown; personal suitability was not inferred from the description.",
        }],
        entityRefs: [{
          entityType: "service",
          entityId: namedCatalogService.serviceId,
          displayName: namedCatalogService.serviceName,
          serviceName: namedCatalogService.serviceName,
          rank: 1,
        }],
        sources: [{
          tool: "get_consultant_service_advice",
          sourceName: "GT API Core active service catalog",
          checkedAt,
          dataStatus: "ok",
          live: true,
          scope: "live",
        }],
        data: { publishedKnowledgeCount: knowledge.length, matchedServiceCount: 0, previewMode: true },
      };
    }

    const dataStatus: AgentDataStatus = knowledgeResult.status === "rejected" ? "unavailable" : "not_ready";
    return {
      toolName: "get_consultant_service_advice",
      sourceName: "GT V2 published Consultant service knowledge",
      checkedAt,
      dataStatus,
      live: false,
      summary:
        knowledge.length === 0
          ? "No published Consultant service knowledge is available yet. An admin must add and publish knowledge before this preview can recommend a service."
          : "I could not confidently match this concern to published service knowledge. Please describe the concern, area, duration, sensitivity, and desired result, or ask for a named service.",
      warnings: [
        ...warnings,
        {
          type: "consultant_no_approved_match",
          title: "No approved service match",
          message: "The Consultant did not guess or use an unpublished draft.",
        },
      ],
      sources: [
        {
          tool: "get_consultant_service_advice",
          sourceName: "GT V2 published Consultant service knowledge",
          checkedAt,
          dataStatus,
          live: false,
          scope: "learned",
        },
      ],
      data: { publishedKnowledgeCount: knowledge.length, matchedServiceCount: 0 },
    };
  }

  const recommendations = ranked.map(({ item, locale }) => {
    const service = catalogMap.get(item.serviceId);
    return {
      recommendationType: "consultant_service_option",
      opportunityKey: item.serviceId,
      title: item.serviceName,
      message: buildAdviceMessage({ service, locale }),
      sourceTools: ["get_consultant_service_advice"],
    };
  });
  const rows = ranked.map(({ item, locale }) => {
    const service = catalogMap.get(item.serviceId);
    return {
      serviceId: item.serviceId,
      serviceName: item.serviceName,
      currentPrice: formatPrice(service?.price),
      durationMinutes: service?.durationMinutes || null,
      whyItMayFit: firstOrFallback(
        [...locale.suitableFor, ...locale.benefits],
        locale.overview || "Matched approved concern tags",
      ),
      important: firstOrFallback(
        [...locale.notSuitableFor, ...locale.limitations],
        "Staff consultation required",
      ),
      knowledgeVersion: item.publishedVersion,
    };
  });
  const top = ranked[0];
  const topService = catalogMap.get(top.item.serviceId);
  const summary = [
    `I found ${ranked.length} possible service option${ranked.length === 1 ? "" : "s"} from The Queen's published knowledge.`,
    `${top.item.serviceName} is the closest match: ${formatPrice(topService?.price)}${topService?.durationMinutes ? `, ${topService.durationMinutes} minutes` : ""}.`,
    `Why it may fit: ${firstOrFallback([...top.locale.suitableFor, ...top.locale.benefits], top.locale.overview)}`,
    `Important: ${firstOrFallback([...top.locale.notSuitableFor, ...top.locale.limitations], "A staff consultation is required to confirm suitability.")}`,
    "This is service guidance, not a medical diagnosis. Final suitability should be confirmed by trained clinic staff.",
  ].join(" ");
  const latestPublishedAt = ranked
    .map((match) => match.item.publishedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? checkedAt;

  return {
    toolName: "get_consultant_service_advice",
    sourceName: "GT V2 published Consultant knowledge + GT API Core service catalog",
    checkedAt,
    dataStatus: catalog.length ? "ok" : "partial",
    live: true,
    summary,
    tables: [
      {
        title: "Consultant service options",
        columns: [
          { key: "serviceName", title: "Service" },
          { key: "currentPrice", title: "Current price" },
          { key: "durationMinutes", title: "Minutes" },
          { key: "whyItMayFit", title: "Why it may fit" },
          { key: "important", title: "Important" },
        ],
        rows,
      },
    ],
    recommendations,
    warnings: warnings.length ? warnings : undefined,
    entityRefs: ranked.map(({ item }, index) => ({
      entityType: "service",
      entityId: item.serviceId,
      displayName: item.serviceName,
      serviceName: item.serviceName,
      rank: index + 1,
    })),
    sources: [
      {
        tool: "get_consultant_service_advice",
        sourceName: "GT V2 published Consultant service knowledge",
        checkedAt: latestPublishedAt,
        dataStatus: "ok",
        live: false,
        scope: "learned",
      },
      {
        tool: "get_consultant_service_advice",
        sourceName: "GT API Core active service catalog",
        checkedAt,
        dataStatus: catalog.length ? "ok" : "unavailable",
        live: true,
        scope: "live",
      },
    ],
    data: {
      publishedKnowledgeCount: knowledge.length,
      matchedServiceCount: ranked.length,
      bookingAvailable: false,
      previewMode: true,
    },
  };
}

async function getConsultantTrendingServices(input: AgentToolInput): Promise<AgentToolResult> {
  requireQueenConsultantClinic(input.clinic);

  const checkedAt = nowIso();
  const [trendResult, catalogResult, knowledgeResult] = await Promise.allSettled([
    runWithAnalyticsQueryContext(
      {
        queryNamePrefix: "agent.consultant.get_consultant_trending_services",
        labels: {
          app: "greattime",
          feature: "agent_hub",
          agent: "consultant",
          tool: "get_consultant_trending_services",
        },
        timeoutMs: env.AGENT_BIGQUERY_TIMEOUT_MS,
        ttlMs: env.BQ_QUERY_DEFAULT_TTL_MS,
        readOnly: true,
      },
      () => getServiceBehaviorReport({
        clinicCode: input.clinic.clinicCode,
        fromDate: input.period.fromDate,
        toDate: input.period.toDate,
        granularity: "month",
      }),
    ),
    getConsultantServiceCatalog({
      clinic: input.clinic,
      authorizationHeader: input.requestContext.authorizationHeader,
    }),
    listConsultantServiceKnowledge({ clinicId: input.clinic.clinicId, publishedOnly: true }),
  ]);

  if (trendResult.status === "rejected") {
    return {
      toolName: "get_consultant_trending_services",
      sourceName: "BigQuery service behavior report",
      checkedAt,
      period: `${input.period.fromDate} to ${input.period.toDate}`,
      dataStatus: "unavailable",
      live: false,
      summary: "Trending service data is unavailable for the selected period.",
      warnings: [{
        type: "consultant_trends_unavailable",
        title: "Trends unavailable",
        message: "The Consultant did not guess which services are trending.",
      }],
    };
  }

  const trend = trendResult.value;
  const catalog = catalogResult.status === "fulfilled" ? catalogResult.value : [];
  const knowledge = knowledgeResult.status === "fulfilled" ? knowledgeResult.value : [];
  const catalogByName = new Map(catalog.map((service) => [normalizeText(service.serviceName), service]));
  const knowledgeByName = new Map(knowledge.map((item) => [normalizeText(item.serviceName), item]));
  const rows = limitRows(trend.topServices, 10).map((row, index) => {
    const service = catalogByName.get(normalizeText(row.serviceName));
    const serviceKnowledge = knowledgeByName.get(normalizeText(row.serviceName));
    return {
      rank: index + 1,
      serviceName: row.serviceName,
      bookingCount: row.bookingCount,
      currentPrice: formatPrice(service?.price),
      durationMinutes: service?.durationMinutes || null,
      consultationKnowledge: serviceKnowledge ? "Published" : "Not published",
    };
  });
  const top = rows[0];

  return {
    toolName: "get_consultant_trending_services",
    sourceName: "BigQuery service trends + GT API Core active service catalog",
    checkedAt,
    period: `${input.period.fromDate} to ${input.period.toDate}`,
    dataStatus: rows.length ? (catalog.length ? "ok" : "partial") : "no_activity",
    live: false,
    summary: top
      ? `${top.serviceName} is the most-booked service in the selected period with ${top.bookingCount.toLocaleString("en-US")} bookings. Its current catalog price is ${top.currentPrice}. Trends describe past activity and do not determine personal suitability.`
      : "No service activity was found for the selected period.",
    metrics: [
      { label: "Bookings", value: trend.summary.totalBookings },
      { label: "Distinct services", value: trend.summary.distinctServices },
    ],
    tables: rows.length ? [{
      title: "Trending services",
      columns: [
        { key: "rank", title: "#" },
        { key: "serviceName", title: "Service" },
        { key: "bookingCount", title: "Bookings" },
        { key: "currentPrice", title: "Current price" },
        { key: "durationMinutes", title: "Minutes" },
        { key: "consultationKnowledge", title: "Knowledge" },
      ],
      rows,
    }] : undefined,
    warnings: catalogResult.status === "rejected" ? [{
      type: "consultant_live_catalog_unavailable",
      title: "Live price unavailable",
      message: "Trend rankings are available, but GT API Core could not provide current prices.",
    }] : undefined,
    entityRefs: rows.map((row) => ({
      entityType: "service",
      entityId: catalogByName.get(normalizeText(row.serviceName))?.serviceId ?? row.serviceName,
      displayName: row.serviceName,
      serviceName: row.serviceName,
      rank: row.rank,
    })),
    sources: [
      {
        tool: "get_consultant_trending_services",
        sourceName: "BigQuery service behavior report",
        checkedAt,
        period: `${input.period.fromDate} to ${input.period.toDate}`,
        dataStatus: rows.length ? "ok" : "no_activity",
        live: false,
        scope: "historical",
      },
      {
        tool: "get_consultant_trending_services",
        sourceName: "GT API Core active service catalog",
        checkedAt,
        dataStatus: catalog.length ? "ok" : "unavailable",
        live: true,
        scope: "live",
      },
    ],
    data: { previewMode: true, bookingAvailable: false },
  };
}

export function createConsultantTools(): AgentToolDefinition[] {
  return [
    {
      name: "get_consultant_service_advice",
      agentId: "consultant",
      description: "Matches a customer concern to published Queen service knowledge and current API Core prices.",
      inputSchema: toolInputSchema,
      sourceName: "GT V2 Consultant knowledge and GT API Core service catalog",
      capability: "read_only",
      live: true,
      maxRows: MAX_ADVICE_RESULTS,
      timeoutMs: 12_000,
      execute: getConsultantServiceAdvice,
    },
    {
      name: "get_consultant_trending_services",
      agentId: "consultant",
      description: "Shows source-backed trending Queen services with current API Core prices.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery service behavior and GT API Core service catalog",
      capability: "read_only",
      live: false,
      maxRows: 10,
      timeoutMs: 15_000,
      execute: getConsultantTrendingServices,
    },
  ];
}
