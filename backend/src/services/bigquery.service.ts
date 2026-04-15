import { bigQueryClient } from "../config/bigquery.js";
import { env } from "../config/env.js";

type QueryOptions = {
  location?: string;
};

export async function runAnalyticsQuery<T>(
  query: string,
  params: Record<string, unknown> = {},
  options: QueryOptions = {},
) {
  const [rows] = await bigQueryClient.query({
    query,
    params,
    location: options.location ?? env.BQ_LOCATION,
  });

  return rows as T[];
}
