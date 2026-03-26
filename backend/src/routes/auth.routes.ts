import { Router } from "express";
import { z } from "zod";
import { exchangeGoogleCredentialForCustomToken } from "../services/apicore.service.js";
import { asyncHandler } from "../utils/async-handler.js";

const router = Router();

const loginSchema = z.object({
  credential: z.string().min(1),
});

router.post(
  "/google",
  asyncHandler(async (req, res) => {
    const { credential } = loginSchema.parse(req.body);
    const customToken = await exchangeGoogleCredentialForCustomToken(credential);

    res.json({
      success: true,
      data: {
        customToken,
      },
    });
  }),
);

export default router;

