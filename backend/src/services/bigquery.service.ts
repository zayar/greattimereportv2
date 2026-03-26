import { bigQueryClient } from "../config/bigquery.js";
import { env } from "../config/env.js";

export async function runAnalyticsQuery<T>(
  query: string,
  params: Record<string, unknown> = {},
) {
  const [rows] = await bigQueryClient.query({
    query,
    params,
    location: env.BQ_LOCATION,
  });

  return rows as T[];
}

