import type { NextFunction, Request, Response } from "express";
import { firebaseAuth } from "../config/firebase.js";
import type { SessionUser } from "../types/auth.js";
import { HttpError } from "../utils/http-error.js";

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

function normalizeClinicClaims(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (typeof entry === "string") {
      return [entry];
    }

    if (entry && typeof entry === "object" && "id" in entry) {
      const id = (entry as { id?: unknown }).id;
      return typeof id === "string" ? [id] : [];
    }

    return [];
  });
}

function normalizeRoles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

export async function verifyFirebaseToken(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      throw new HttpError(401, "Missing Firebase bearer token.");
    }

    const idToken = header.slice("Bearer ".length).trim();
    if (!idToken) {
      throw new HttpError(401, "Invalid Firebase bearer token.");
    }

    const decoded = await firebaseAuth().verifyIdToken(idToken, true);

    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      name: typeof decoded.name === "string" ? decoded.name : undefined,
      userId: typeof decoded.userId === "string" ? decoded.userId : undefined,
      roles: normalizeRoles(decoded.roles),
      clinicIds: normalizeClinicClaims(decoded.clinics),
    };

    next();
  } catch (error) {
    next(error);
  }
}

