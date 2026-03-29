import { Router } from "express";
import authRoutes from "./auth.routes.js";
import analyticsRoutes from "./analytics.routes.js";
import aiRoutes from "./ai.routes.js";
import telegramRoutes from "./telegram.routes.js";

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
router.use("/analytics", analyticsRoutes);
router.use("/ai", aiRoutes);
router.use("/integrations/telegram", telegramRoutes);

export default router;
