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
  BQ_CUSTOMER_PACKAGE_DAILY_TABLE: z.string().default("gt_ai_customer_package_daily"),
  BQ_CUSTOMER_RELATIONSHIP_DAILY_TABLE: z.string().default("gt_ai_customer_relationship_daily"),
  GT_GROWTH_AI_DEFAULT_ENABLED: booleanEnv(false),
  GT_GROWTH_AI_ENABLED_CLINIC_IDS: z.string().default(""),
  GT_GROWTH_AI_FEATURE_STORE_ENABLED: booleanEnv(true),
  GT_GROWTH_AI_ADMIN_EMAILS: z.string().default("zayar@datafocus.cloud"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  TELEGRAM_LINK_CODE_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  TELEGRAM_REPORT_DEFAULT_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("08:00"),
  TELEGRAM_API_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  TELEGRAM_SCHEDULER_ENABLED: booleanEnv(true),
  TELEGRAM_SCHEDULER_INTERVAL_MS: z.coerce.number().int().positive().default(30 * 60_000),
  TELEGRAM_SCHEDULER_BUSY_TIMEOUT_MS: z.coerce.number().int().positive().default(4 * 60_000),
  TELEGRAM_SCHEDULER_SECRET: z.string().optional(),
  TELEGRAM_WEBHOOK_ENABLED: booleanEnv(true),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_WEBHOOK_WATCHDOG_ENABLED: booleanEnv(true),
  TELEGRAM_WEBHOOK_WATCHDOG_INTERVAL_MS: z.coerce.number().int().positive().default(5 * 60_000),
  TELEGRAM_POLLING_ENABLED: booleanEnv(false),
  TELEGRAM_POLLING_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  APICORE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  FIREBASE_AUTH_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  AGENT_MEMORY_V2_ENABLED: booleanEnv(false),
  AGENT_LEARNING_ENABLED: booleanEnv(false),
  AGENT_LEARNING_SCHEDULER_SECRET: z.string().optional(),
  AGENT_LEARNING_DEFAULT_LOOKBACK_DAYS: z.coerce.number().int().positive().default(365),
  AGENT_STALE_THRESHOLD_HOURS: z.coerce.number().int().positive().default(24),
  AGENT_LEARNING_SCHEDULER_JOB_NAME: z.string().default("gt-v2report-agent-learning-scheduler"),
  AGENT_LEARNING_SCHEDULER_CRON: z.string().default("*/15 * * * *"),
  AGENT_LEARNING_SCHEDULER_TIME_ZONE: z.string().default("Asia/Yangon"),
  AGENT_OPERATIONAL_SNAPSHOT_INTERVAL_MINUTES: z.coerce.number().int().refine((value) => [15, 30, 60].includes(value)).default(15),
  AGENT_LEARNING_MAX_CLINIC_CONCURRENCY: z.coerce.number().int().positive().default(3),
  CUSTOMER_RELATIONSHIP_DAILY_MEMORY_V2_ENABLED: booleanEnv(false),
  CUSTOMER_RELATIONSHIP_UNACTIVATED_GRACE_DAYS: z.coerce.number().int().min(1).max(60).default(7),
  CUSTOMER_RELATIONSHIP_DORMANT_ACTIVE_BALANCE_DAYS: z.coerce.number().int().min(30).max(365).default(90),
  CUSTOMER_RELATIONSHIP_FOLLOW_UP_COOLDOWN_DAYS: z.coerce.number().int().min(0).max(90).default(7),
  CUSTOMER_RELATIONSHIP_NOT_INTERESTED_COOLDOWN_DAYS: z.coerce.number().int().min(1).max(365).default(60),
});

export const env = envSchema.parse(process.env);
