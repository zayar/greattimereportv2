import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(5050),
  CORS_ORIGIN: z.string().default("http://localhost:5174"),
  APICORE_GRAPHQL_URL: z.string().url(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  BQ_PROJECT_ID: z.string().default("pitistartup"),
  BQ_DATASET: z.string().default("great_time"),
  BQ_LOCATION: z.string().default("US"),
  BQ_MAIN_DATA_VIEW: z.string().default("MainDataView"),
  BQ_MAIN_PAYMENT_VIEW: z.string().default("MainPaymentView"),
});

export const env = envSchema.parse(process.env);

