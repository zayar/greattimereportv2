import { Router } from "express";
import { z } from "zod";
import { verifyFirebaseToken } from "../middleware/auth.js";
import { requireClinicAccess } from "../middleware/clinic-access.js";
import { requireAiControlPanelAdmin } from "../services/ai-control-panel-access.service.js";
import {
  getClinicGtGrowthAiAccess,
  updateClinicGtGrowthAiAccess,
} from "../services/feature-access.service.js";
import { asyncHandler } from "../utils/async-handler.js";

const router = Router();

const clinicFeatureQuerySchema = z.object({
  clinicId: z.string().min(1),
});

const clinicFeatureUpdateSchema = z.object({
  clinicId: z.string().min(1),
  enabled: z.boolean(),
});

router.use(verifyFirebaseToken);

router.get(
  "/gt-growth-ai",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = clinicFeatureQuerySchema.parse(req.query);
    const gtGrowthAi = await getClinicGtGrowthAiAccess(params.clinicId);

    res.json({
      success: true,
      data: {
        gtGrowthAi,
      },
    });
  }),
);

router.post(
  "/gt-growth-ai",
  requireClinicAccess("body", "clinicId"),
  asyncHandler(async (req, res) => {
    requireAiControlPanelAdmin(req);

    const params = clinicFeatureUpdateSchema.parse(req.body);
    const gtGrowthAi = await updateClinicGtGrowthAiAccess({
      clinicId: params.clinicId,
      enabled: params.enabled,
      updatedByUserId: req.user?.userId ?? req.user?.uid ?? null,
      updatedByEmail: req.user?.email ?? null,
    });

    res.json({
      success: true,
      data: {
        gtGrowthAi,
      },
    });
  }),
);

export default router;
