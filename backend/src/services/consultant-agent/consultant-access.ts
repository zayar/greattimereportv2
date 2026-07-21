import { HttpError } from "../../utils/http-error.js";
import type { AgentClinicContext } from "../agent-hub/types.js";

export const QUEEN_CONSULTANT_CLINIC_CODE = "GTTHEQUEEN";

export function isQueenConsultantClinic(clinic: AgentClinicContext) {
  return clinic.clinicCode.trim().toUpperCase() === QUEEN_CONSULTANT_CLINIC_CODE;
}

export function requireQueenConsultantClinic(clinic: AgentClinicContext) {
  if (!isQueenConsultantClinic(clinic)) {
    throw new HttpError(403, "Consultant Agent preview is currently available only for The Queen.");
  }
}
