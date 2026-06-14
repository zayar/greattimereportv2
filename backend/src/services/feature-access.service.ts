import { env } from "../config/env.js";
import {
  GT_GROWTH_AI_FEATURE_GATE,
  type ReportPremiumAccess,
  type ReportPremiumTeaser,
} from "../types/report-ai.js";

type FeatureAccessInput = {
  clinicId?: string | null;
  feature: typeof GT_GROWTH_AI_FEATURE_GATE;
  teaser?: ReportPremiumTeaser;
};

function parseClinicIdList(value: string) {
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
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

export async function hasFeatureAccess(input: FeatureAccessInput): Promise<ReportPremiumAccess> {
  if (input.feature !== GT_GROWTH_AI_FEATURE_GATE) {
    return buildGtGrowthAiAccess({
      enabled: false,
      lockedReason: "Unsupported premium feature.",
      teaser: input.teaser,
    });
  }

  const enabledClinicIds = parseClinicIdList(env.GT_GROWTH_AI_ENABLED_CLINIC_IDS);
  const enabled =
    env.GT_GROWTH_AI_DEFAULT_ENABLED ||
    (input.clinicId != null && input.clinicId.trim() !== "" && enabledClinicIds.has(input.clinicId.trim()));

  return buildGtGrowthAiAccess({
    enabled,
    lockedReason: enabled
      ? undefined
      : input.clinicId
        ? "gt_growth_ai is not enabled for this clinic."
        : "Clinic entitlement could not be checked.",
    teaser: input.teaser,
  });
}

// TODO(gt_growth_ai): Replace the environment-based check with the production subscription or
// entitlement source once GT Growth AI billing is available. Basic report data must remain free.
export function buildLockedGtGrowthAiAccess(teaser?: ReportPremiumTeaser): ReportPremiumAccess {
  return buildGtGrowthAiAccess({
    enabled: false,
    lockedReason: "gt_growth_ai is not enabled for this clinic.",
    teaser,
  });
}
