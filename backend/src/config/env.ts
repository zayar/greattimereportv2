import "dotenv/config";
import { z } from "zod";

function booleanEnv(defaultValue: boolean) {
  return z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === null || value.trim() === "") {
        return defaultValue;
      }

      return value.trim().toLowerCase() === "true";
    });
}

const envSchema = z.object({
  PORT: z.coerce.number().default(5050),
  CORS_ORIGIN: z.string().default("http://localhost:5174"),
  APICORE_GRAPHQL_URL: z.string().url(),
  APICORE_SERVICE_USERNAME: z.string().optional(),
  APICORE_SERVICE_PASSWORD: z.string().optional(),
  AI_PROVIDER: z.enum(["gemini"]).default("gemini"),
  AI_DEFAULT_LANGUAGE: z.string().default("my-MM"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash"),
  GEMINI_API_BASE_URL: z.string().url().default("https://generativelanguage.googleapis.com/v1beta"),
  APP_BASE_URL: z.string().url().optional(),
  DEFAULT_TIMEZONE: z.string().default("Asia/Yangon"),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  FIREBASE_WEB_API_KEY: z.string().optional(),
  BQ_PROJECT_ID: z.string().default("pitistartup"),
  BQ_DATASET: z.string().default("great_time"),
  BQ_LOCATION: z.string().default("US"),
  BQ_MAIN_DATA_VIEW: z.string().default("MainDataView"),
  BQ_MAIN_PAYMENT_VIEW: z.string().default("MainPaymentView"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  TELEGRAM_LINK_CODE_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  TELEGRAM_REPORT_DEFAULT_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("08:00"),
  TELEGRAM_SCHEDULER_ENABLED: booleanEnv(true),
  TELEGRAM_SCHEDULER_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  TELEGRAM_WEBHOOK_ENABLED: booleanEnv(true),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_POLLING_ENABLED: booleanEnv(false),
  TELEGRAM_POLLING_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
});

export const env = envSchema.parse(process.env);
