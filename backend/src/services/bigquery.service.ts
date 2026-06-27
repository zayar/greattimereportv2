import { createHash } from "node:crypto";
import type { Query } from "@google-cloud/bigquery";
import { bigQueryClient } from "../config/bigquery.js";
import { env } from "../config/env.js";
import { getAnalyticsQueryContext } from "./analytics-query-context.js";
import { assertAgentReadOnlySql } from "./agent-hub/read-only-guard.js";

export type AnalyticsQueryOptions = {
  location?: string;
  queryName?: string;
  cacheKey?: string;
  ttlMs?: number;
  timeoutMs?: number;
  labels?: Record<string, string>;
  maxBytesBilled?: number;
  useQueryCache?: boolean;
  forceRefresh?: boolean;
};

type AnalyticsQueryCacheEntry = {
  rows: unknown[];
  expiresAt: number;
};

type AnalyticsQueryCacheStats = {
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
  entries: number;
};

const analyticsQueryCache = new Map<string, AnalyticsQueryCacheEntry>();
const analyticsQueryCacheStats = {
  hits: 0,
  misses: 0,
  sets: 0,
  evictions: 0,
};

function hashText(value: string, length = 32) {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return '"__undefined__"';
  }

  if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "bigint") {
    return JSON.stringify(value.toString());
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(String(value));
}

export function buildAnalyticsQueryCacheKey(
  query: string,
  params: Record<string, unknown> = {},
  location = env.BQ_LOCATION,
  cacheKey?: string,
) {
  const cacheInput = stableStringify({ cacheKey: cacheKey ?? null, query, params, location });
  return `analytics:${hashText(cacheInput)}`;
}

export function clearAnalyticsQueryCache() {
  analyticsQueryCache.clear();
  analyticsQueryCacheStats.hits = 0;
  analyticsQueryCacheStats.misses = 0;
  analyticsQueryCacheStats.sets = 0;
  analyticsQueryCacheStats.evictions = 0;
}

export function getAnalyticsQueryCacheStats(): AnalyticsQueryCacheStats {
  return {
    ...analyticsQueryCacheStats,
    entries: analyticsQueryCache.size,
  };
}

function stripLeadingSqlComments(query: string) {
  let text = query.trim();
  let previous = "";

  while (text !== previous) {
    previous = text;
    text = text
      .replace(/^--[^\n]*(\n|$)/, "")
      .replace(/^\/\*[\s\S]*?\*\//, "")
      .trim();
  }

  return text;
}

function isSelectStyleQuery(query: string) {
  const normalized = stripLeadingSqlComments(query).toLowerCase();
  return normalized.startsWith("select") || normalized.startsWith("with");
}

function evictOldestEntries(maxEntries: number) {
  while (analyticsQueryCache.size > maxEntries) {
    const oldestKey = analyticsQueryCache.keys().next().value as string | undefined;
    if (!oldestKey) {
      return;
    }

    analyticsQueryCache.delete(oldestKey);
    analyticsQueryCacheStats.evictions += 1;
  }
}

function getCachedRows<T>(cacheKey: string, now: number): T[] | null {
  const entry = analyticsQueryCache.get(cacheKey);
  if (!entry) {
    analyticsQueryCacheStats.misses += 1;
    return null;
  }

  if (entry.expiresAt <= now) {
    analyticsQueryCache.delete(cacheKey);
    analyticsQueryCacheStats.misses += 1;
    return null;
  }

  analyticsQueryCacheStats.hits += 1;
  return cloneRows(entry.rows) as T[];
}

function setCachedRows(cacheKey: string, rows: unknown[], ttlMs: number, now: number) {
  analyticsQueryCache.set(cacheKey, {
    rows: cloneRows(rows),
    expiresAt: now + ttlMs,
  });
  analyticsQueryCacheStats.sets += 1;
  evictOldestEntries(env.BQ_QUERY_CACHE_MAX_ENTRIES);
}

function cloneRows(rows: unknown[]) {
  if (typeof globalThis.structuredClone === "function") {
    try {
      return globalThis.structuredClone(rows) as unknown[];
    } catch {
      return rows.map((row) => cloneCacheValue(row));
    }
  }

  return rows.map((row) => cloneCacheValue(row));
}

function cloneCacheValue(value: unknown): unknown {
  if (value == null || typeof value === "number" || typeof value === "string" || typeof value === "boolean" || typeof value === "bigint") {
    return value;
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneCacheValue(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneCacheValue(item)]),
    );
  }

  return value;
}

function sanitizeLabelSegment(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[^a-z]+/, "")
    .slice(0, 63);

  return normalized || "query";
}

function sanitizeLabels(labels: Record<string, string> | undefined) {
  if (!labels) {
    return undefined;
  }

  const safeLabels = Object.entries(labels).reduce<Record<string, string>>((acc, [key, value]) => {
    acc[sanitizeLabelSegment(key)] = sanitizeLabelSegment(value);
    return acc;
  }, {});

  return Object.keys(safeLabels).length > 0 ? safeLabels : undefined;
}

function sanitizeQueryError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
      .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
      .replace(/key=([^&\s]+)/gi, "key=[redacted]")
      .slice(0, 240);
  }

  return "BigQuery query failed.";
}

function buildLogContext(params: {
  event: string;
  queryName: string;
  queryHash: string;
  durationMs: number;
  rowCount: number;
  cacheHit: boolean;
  dataStatus: "ok" | "error";
  location: string;
}) {
  return {
    event: params.event,
    queryName: params.queryName,
    queryHash: params.queryHash,
    durationMs: params.durationMs,
    rowCount: params.rowCount,
    cacheHit: params.cacheHit,
    dataStatus: params.dataStatus,
    location: params.location,
  };
}

function logQueryCompleted(params: {
  queryName: string;
  queryHash: string;
  startedAt: number;
  rowCount: number;
  cacheHit: boolean;
  dataStatus: "ok" | "error";
  location: string;
}) {
  const durationMs = Date.now() - params.startedAt;
  const context = buildLogContext({
    event: "bigquery_query_completed",
    queryName: params.queryName,
    queryHash: params.queryHash,
    durationMs,
    rowCount: params.rowCount,
    cacheHit: params.cacheHit,
    dataStatus: params.dataStatus,
    location: params.location,
  });

  console.info(context);

  if (durationMs >= env.BQ_QUERY_SLOW_MS) {
    console.warn({
      ...context,
      event: "bigquery_query_slow",
    });
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, queryName: string) {
  if (timeoutMs <= 0) {
    return promise;
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  return new Promise<T>((resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`BigQuery query ${queryName} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    promise.then(resolve, reject).finally(() => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    });
  });
}

export async function runAnalyticsQuery<T>(
  query: string,
  params: Record<string, unknown> = {},
  options: AnalyticsQueryOptions = {},
) {
  const context = getAnalyticsQueryContext();
  const location = options.location ?? env.BQ_LOCATION;
  const queryName = options.queryName ?? context?.queryNamePrefix ?? "analytics_query";
  const queryHash = hashText(query, 16);
  const startedAt = Date.now();
  const ttlMs = options.ttlMs ?? context?.ttlMs ?? env.BQ_QUERY_DEFAULT_TTL_MS;
  const forceRefresh = options.forceRefresh ?? context?.forceRefresh ?? false;
  const cacheKey = buildAnalyticsQueryCacheKey(query, params, location, options.cacheKey);
  const rawLabels = {
    ...(context?.labels ?? {}),
    ...(options.labels ?? {}),
  };

  if (context?.readOnly === true) {
    assertAgentReadOnlySql(query);
  }

  const shouldUseCache =
    env.BQ_QUERY_CACHE_ENABLED && !forceRefresh && ttlMs > 0 && isSelectStyleQuery(query);

  if (shouldUseCache) {
    const cachedRows = getCachedRows<T>(cacheKey, startedAt);
    if (cachedRows) {
      logQueryCompleted({
        queryName,
        queryHash,
        startedAt,
        rowCount: cachedRows.length,
        cacheHit: true,
        dataStatus: "ok",
        location,
      });

      return cachedRows;
    }
  }

  const maxBytesBilled = options.maxBytesBilled ?? context?.maxBytesBilled ?? env.BQ_MAX_BYTES_BILLED;
  const labels = sanitizeLabels(rawLabels);
  const useQueryCache = options.useQueryCache ?? context?.useQueryCache;
  const queryOptions: Query = {
    query,
    params,
    location,
    ...(labels ? { labels } : {}),
    ...(maxBytesBilled > 0 ? { maximumBytesBilled: String(maxBytesBilled) } : {}),
    ...(useQueryCache === undefined ? {} : { useQueryCache }),
  };

  try {
    const [rows] = await withTimeout(bigQueryClient.query(queryOptions), options.timeoutMs ?? context?.timeoutMs ?? env.BQ_QUERY_TIMEOUT_MS, queryName);
    const resultRows = rows as T[];

    logQueryCompleted({
      queryName,
      queryHash,
      startedAt,
      rowCount: Array.isArray(resultRows) ? resultRows.length : 0,
      cacheHit: false,
      dataStatus: "ok",
      location,
    });

    if (shouldUseCache && Array.isArray(resultRows)) {
      setCachedRows(cacheKey, resultRows, ttlMs, startedAt);
    }

    return resultRows;
  } catch (error) {
    const sanitizedError = sanitizeQueryError(error);

    logQueryCompleted({
      queryName,
      queryHash,
      startedAt,
      rowCount: 0,
      cacheHit: false,
      dataStatus: "error",
      location,
    });
    console.warn({
      event: "bigquery_query_failed",
      queryName,
      queryHash,
      durationMs: Date.now() - startedAt,
      rowCount: 0,
      cacheHit: false,
      dataStatus: "error",
      location,
      error: sanitizedError,
    });

    throw error;
  }
}

export async function runAgentReadOnlyAnalyticsQuery<T>(
  query: string,
  params: Record<string, unknown> = {},
  options: AnalyticsQueryOptions = {},
) {
  assertAgentReadOnlySql(query);
  return runAnalyticsQuery<T>(query, params, options);
}
