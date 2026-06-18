import type { Request } from "express";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";

export function parseAiControlPanelAdminEmails(value: string) {
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAiControlPanelAdminEmail(email?: string | null) {
  const normalizedEmail = email?.trim().toLowerCase() ?? "";
  return normalizedEmail !== "" && parseAiControlPanelAdminEmails(env.GT_GROWTH_AI_ADMIN_EMAILS).has(normalizedEmail);
}

export function requireAiControlPanelAdmin(req: Request) {
  if (!isAiControlPanelAdminEmail(req.user?.email)) {
    throw new HttpError(403, "AI Control Panel access is restricted.");
  }
}
