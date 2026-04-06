import { Router } from "express";
import authRoutes from "./auth.routes.js";
import analyticsRoutes from "./analytics.routes.js";
import aiRoutes from "./ai.routes.js";
import apicoreRoutes from "./apicore.routes.js";
import telegramRoutes from "./telegram.routes.js";
import commissionRoutes from "./commission.routes.js";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: {
      service: "GT_V2Report backend",
      status: "ok",
    },
  });
});

router.use("/auth", authRoutes);
router.use("/apicore", apicoreRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/ai", aiRoutes);
router.use("/integrations/telegram", telegramRoutes);
router.use("/commission", commissionRoutes);

export default router;
