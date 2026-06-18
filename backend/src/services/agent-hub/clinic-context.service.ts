import { HttpError } from "../../utils/http-error.js";
import type { SessionUser } from "../../types/auth.js";
import type { AgentClinicContext } from "./types.js";

export function resolveAgentClinicContext(params: {
  user?: SessionUser;
  clinicId: string;
  clinicCode?: string;
}): AgentClinicContext {
  if (!params.user) {
    throw new HttpError(401, "User session is required.");
  }

  if (!params.user.clinicIds.includes(params.clinicId)) {
    throw new HttpError(403, "You do not have access to this clinic.");
  }

  const clinicCode = params.clinicCode?.trim();
  if (!clinicCode) {
    throw new HttpError(400, "clinicCode is required for source-grounded Agent Hub answers.");
  }

  return {
    clinicId: params.clinicId,
    clinicCode,
  };
}
