import { readFileSync } from "node:fs";
import { BigQuery } from "@google-cloud/bigquery";
import { env } from "./env.js";

type ServiceAccountShape = {
  project_id: string;
  client_email: string;
  private_key: string;
};

function readCredentials(): ServiceAccountShape | null {
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as ServiceAccountShape;
  }

  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    const raw = readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, "utf8");
    return JSON.parse(raw) as ServiceAccountShape;
  }

  return null;
}

const credentials = readCredentials();

export const analyticsTables = {
  mainDataView: `\`${env.BQ_PROJECT_ID}.${env.BQ_DATASET}.${env.BQ_MAIN_DATA_VIEW}\``,
  mainPaymentView: `\`${env.BQ_PROJECT_ID}.${env.BQ_DATASET}.${env.BQ_MAIN_PAYMENT_VIEW}\``,
};

export const bigQueryClient = new BigQuery({
  projectId: env.BQ_PROJECT_ID,
  location: env.BQ_LOCATION,
  ...(credentials
    ? {
        credentials: {
          project_id: credentials.project_id,
          client_email: credentials.client_email,
          private_key: credentials.private_key,
        },
      }
    : {}),
});

