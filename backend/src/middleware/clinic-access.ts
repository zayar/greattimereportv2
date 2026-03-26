import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/http-error.js";

export function requireClinicAccess(source: "query" | "body" = "query", key = "clinicId") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const clinicId =
      source === "query"
        ? req.query[key]
        : (req.body as Record<string, unknown> | undefined)?.[key];

    if (typeof clinicId !== "string" || clinicId.length === 0) {
      next(new HttpError(400, `Missing required ${key}.`));
      return;
    }

    if (!req.user) {
      next(new HttpError(401, "User session is required."));
      return;
    }

    if (!req.user.clinicIds.includes(clinicId)) {
      next(new HttpError(403, "You do not have access to this clinic."));
      return;
    }

    next();
  };
}

