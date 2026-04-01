import { Router } from "express";
import { verifyFirebaseToken } from "../middleware/auth.js";
import { forwardApicoreGraphqlRequest } from "../services/apicore.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";

const router = Router();

router.use(verifyFirebaseToken);

router.post(
  "/graphql",
  asyncHandler(async (req, res) => {
    if (!req.body || typeof req.body !== "object" || typeof req.body.query !== "string") {
      throw new HttpError(400, "GraphQL query body is required.");
    }

    const payload = await forwardApicoreGraphqlRequest({
      requestBody: req.body as Record<string, unknown>,
      authorizationHeader: req.headers.authorization,
    });

    res.status(200).json(payload);
  }),
);

export default router;
