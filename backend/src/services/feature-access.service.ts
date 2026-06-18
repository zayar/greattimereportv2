import { env } from "../config/env.js";
import { firestoreDb } from "../config/firebase.js";
import {
  GT_GROWTH_AI_FEATURE_GATE,
  type ReportPremiumAccess,
  type ReportPremiumTeaser,
} from "../types/report-ai.js";
import { HttpError } from "../utils/http-error.js";

const FEATURE_ACCESS_COLLECTION = "gt_v2report_feature_access";

type FeatureAccessInput = {
  clinicId?: string | null;
  feature: typeof GT_GROWTH_AI_FEATURE_GATE;
  teaser?: ReportPremiumTeaser;
};

export type ClinicFeatureAccessSource = "environment" | "clinic_setting" | "default_locked";

export interface ClinicFeatureAccessStatus {
  clinicId: string;
  feature: typeof GT_GROWTH_AI_FEATURE_GATE;
  enabled: boolean;
  source: ClinicFeatureAccessSource;
  title: string;
  message: string;
  upgradeMessage?: string;
  lockedReason?: string;
  updatedAt?: string | null;
  updatedByUserId?: string | null;
  updatedByEmail?: string | null;
}

type StoredFeatureAccess = {
  enabled?: unknown;
  updatedAt?: unknown;
  updatedByUserId?: unknown;
  updatedByEmail?: unknown;
};

function parseClinicIdList(value: string) {
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function featureAccessRef(clinicId: string) {
  return firestoreDb().collection(FEATURE_ACCESS_COLLECTION).doc(clinicId);
}

function getEnvAccess(clinicId?: string | null) {
  const normalizedClinicId = clinicId?.trim() ?? "";
  const enabledClinicIds = parseClinicIdList(env.GT_GROWTH_AI_ENABLED_CLINIC_IDS);

  return env.GT_GROWTH_AI_DEFAULT_ENABLED || (normalizedClinicId !== "" && enabledClinicIds.has(normalizedClinicId));
}

function parseStoredFeatureAccess(value: unknown): StoredFeatureAccess | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  return {
    enabled: record.enabled,
    updatedAt: record.updatedAt,
    updatedByUserId: record.updatedByUserId,
    updatedByEmail: record.updatedByEmail,
  };
}

function parseIsoText(value: unknown) {
  return typeof value === "string" ? value : null;
}

async function readStoredGtGrowthAiAccess(clinicId: string) {
  if (!env.GT_GROWTH_AI_FEATURE_STORE_ENABLED) {
    return null;
  }

  try {
    const snapshot = await featureAccessRef(clinicId).get();
    const data = snapshot.data() as Record<string, unknown> | undefined;
    const features = data?.features && typeof data.features === "object" ? (data.features as Record<string, unknown>) : {};
    const stored = parseStoredFeatureAccess(features[GT_GROWTH_AI_FEATURE_GATE]);

    if (typeof stored?.enabled !== "boolean") {
      return null;
    }

    return {
      enabled: stored.enabled,
      updatedAt: parseIsoText(stored.updatedAt),
      updatedByUserId: parseIsoText(stored.updatedByUserId),
      updatedByEmail: parseIsoText(stored.updatedByEmail),
    };
  } catch (error) {
    console.warn("[GT_V2Report][GT Growth AI] feature access lookup failed", {
      clinicId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }
}

function buildGtGrowthAiAccess(params: {
  enabled: boolean;
  lockedReason?: string;
  teaser?: ReportPremiumTeaser;
}): ReportPremiumAccess {
  if (params.enabled) {
    return {
      feature: GT_GROWTH_AI_FEATURE_GATE,
      enabled: true,
      title: "GT Growth AI",
      message: "AI insights and recommended actions are enabled for this clinic.",
      upgradeMessage: undefined,
    };
  }

  return {
    feature: GT_GROWTH_AI_FEATURE_GATE,
    enabled: false,
    title: "Unlock GT Growth AI",
    message: "AI insights and recommended actions are available with GT Growth AI.",
    upgradeMessage: "Upgrade to see AI recommendations.",
    lockedReason: params.lockedReason,
    teaser: params.teaser,
  };
}

function buildStatus(input: {
  clinicId: string;
  enabled: boolean;
  source: ClinicFeatureAccessSource;
  lockedReason?: string;
  updatedAt?: string | null;
  updatedByUserId?: string | null;
  updatedByEmail?: string | null;
}): ClinicFeatureAccessStatus {
  const premium = buildGtGrowthAiAccess({
    enabled: input.enabled,
    lockedReason: input.lockedReason,
  });

  return {
    clinicId: input.clinicId,
    feature: GT_GROWTH_AI_FEATURE_GATE,
    enabled: input.enabled,
    source: input.source,
    title: premium.title,
    message: premium.message,
    upgradeMessage: premium.upgradeMessage,
    lockedReason: premium.lockedReason,
    updatedAt: input.updatedAt ?? null,
    updatedByUserId: input.updatedByUserId ?? null,
    updatedByEmail: input.updatedByEmail ?? null,
  };
}

export async function hasFeatureAccess(input: FeatureAccessInput): Promise<ReportPremiumAccess> {
  if (input.feature !== GT_GROWTH_AI_FEATURE_GATE) {
    return buildGtGrowthAiAccess({
      enabled: false,
      lockedReason: "Unsupported premium feature.",
      teaser: input.teaser,
    });
  }

  const clinicId = input.clinicId?.trim() ?? "";
  const envEnabled = getEnvAccess(clinicId);
  const storedAccess = clinicId && !envEnabled ? await readStoredGtGrowthAiAccess(clinicId) : null;
  const enabled = envEnabled || storedAccess?.enabled === true;

  return buildGtGrowthAiAccess({
    enabled,
    lockedReason: enabled
      ? undefined
      : clinicId
        ? "gt_growth_ai is not enabled for this clinic."
        : "Clinic entitlement could not be checked.",
    teaser: input.teaser,
  });
}

export async function getClinicGtGrowthAiAccess(clinicId: string): Promise<ClinicFeatureAccessStatus> {
  const normalizedClinicId = clinicId.trim();
  const envEnabled = getEnvAccess(normalizedClinicId);
  if (envEnabled) {
    return buildStatus({
      clinicId: normalizedClinicId,
      enabled: true,
      source: "environment",
    });
  }

  const storedAccess = await readStoredGtGrowthAiAccess(normalizedClinicId);
  if (storedAccess) {
    return buildStatus({
      clinicId: normalizedClinicId,
      enabled: storedAccess.enabled,
      source: "clinic_setting",
      lockedReason: storedAccess.enabled ? undefined : "gt_growth_ai is disabled in clinic feature settings.",
      updatedAt: storedAccess.updatedAt,
      updatedByUserId: storedAccess.updatedByUserId,
      updatedByEmail: storedAccess.updatedByEmail,
    });
  }

  return buildStatus({
    clinicId: normalizedClinicId,
    enabled: false,
    source: "default_locked",
    lockedReason: "gt_growth_ai is not enabled for this clinic.",
  });
}

export async function updateClinicGtGrowthAiAccess(input: {
  clinicId: string;
  enabled: boolean;
  updatedByUserId?: string | null;
  updatedByEmail?: string | null;
}) {
  if (!env.GT_GROWTH_AI_FEATURE_STORE_ENABLED) {
    throw new HttpError(503, "GT Growth AI feature store is not enabled.");
  }

  const clinicId = input.clinicId.trim();
  const updatedAt = new Date().toISOString();

  await featureAccessRef(clinicId).set(
    {
      clinicId,
      updatedAt,
      features: {
        [GT_GROWTH_AI_FEATURE_GATE]: {
          enabled: input.enabled,
          updatedAt,
          updatedByUserId: input.updatedByUserId ?? null,
          updatedByEmail: input.updatedByEmail ?? null,
        },
      },
    },
    { merge: true },
  );

  return getClinicGtGrowthAiAccess(clinicId);
}

// TODO(gt_growth_ai): Replace this temporary clinic setting with the production subscription
// entitlement source once GT Growth AI billing is available. Basic report data must remain free.
export function buildLockedGtGrowthAiAccess(teaser?: ReportPremiumTeaser): ReportPremiumAccess {
  return buildGtGrowthAiAccess({
    enabled: false,
    lockedReason: "gt_growth_ai is not enabled for this clinic.",
    teaser,
  });
}
