import { AsyncLocalStorage } from "node:async_hooks";

export type AnalyticsQueryContext = {
  queryNamePrefix?: string;
  ttlMs?: number;
  timeoutMs?: number;
  labels?: Record<string, string>;
  useQueryCache?: boolean;
  forceRefresh?: boolean;
  maxBytesBilled?: number;
};

const analyticsQueryContextStorage = new AsyncLocalStorage<AnalyticsQueryContext>();

export function runWithAnalyticsQueryContext<T>(context: AnalyticsQueryContext, callback: () => Promise<T>): Promise<T> {
  return analyticsQueryContextStorage.run(context, callback);
}

export function getAnalyticsQueryContext() {
  return analyticsQueryContextStorage.getStore();
}
