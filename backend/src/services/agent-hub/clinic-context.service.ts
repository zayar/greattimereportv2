import { HttpError } from "../../utils/http-error.js";
import type { SessionUser } from "../../types/auth.js";
import { queryApicoreWithFallback } from "../apicore.service.js";
import type { AgentClinicContext } from "./types.js";

const AGENT_CLINIC_CONTEXT_CACHE_TTL_MS = 5 * 60_000;

const AGENT_CLINIC_CONTEXT_QUERY = `
  query AgentHubClinicContext($clinicIds: [String!]) {
    clinics(where: { id: { in: $clinicIds } }) {
      id
      code
    }
  }
`;

type AgentClinicCodeLookup = (params: {
  clinicId: string;
  authorizationHeader?: string;
}) => Promise<string | null>;

const clinicCodeCache = new Map<string, { code: string; expiresAt: number }>();

async function lookupAgentClinicCode(params: {
  clinicId: string;
  authorizationHeader?: string;
}) {
  const cached = clinicCodeCache.get(params.clinicId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.code;
  }

  const data = await queryApicoreWithFallback<{
    clinics?: Array<{ id?: string | null; code?: string | null }> | null;
  }>({
    query: AGENT_CLINIC_CONTEXT_QUERY,
    variables: { clinicIds: [params.clinicId] },
    authorizationHeader: params.authorizationHeader,
    errorMessage: "Unable to resolve the authorized clinic context.",
    readOnly: true,
  });
  const code = data?.clinics
    ?.find((clinic) => clinic.id === params.clinicId)
    ?.code?.trim();

  if (!code) {
    return null;
  }

  clinicCodeCache.set(params.clinicId, {
    code,
    expiresAt: Date.now() + AGENT_CLINIC_CONTEXT_CACHE_TTL_MS,
  });

  return code;
}

export function clearAgentClinicContextCache() {
  clinicCodeCache.clear();
}

export async function lookupAgentClinicCodes(clinicIds: string[]): Promise<Record<string, string>> {
  const normalizedClinicIds = [...new Set(clinicIds.map((clinicId) => clinicId.trim()).filter(Boolean))];
  if (normalizedClinicIds.length === 0) {
    return {};
  }

  const data = await queryApicoreWithFallback<{
    clinics?: Array<{ id?: string | null; code?: string | null }> | null;
  }>({
    query: AGENT_CLINIC_CONTEXT_QUERY,
    variables: { clinicIds: normalizedClinicIds },
    errorMessage: "Unable to resolve clinic codes for scheduled AI Revenue generation.",
    readOnly: true,
  });

  return Object.fromEntries(
    (data?.clinics ?? [])
      .map((clinic) => ({ clinicId: clinic.id?.trim(), clinicCode: clinic.code?.trim() }))
      .filter((clinic): clinic is { clinicId: string; clinicCode: string } => Boolean(clinic.clinicId && clinic.clinicCode))
      .map((clinic) => [clinic.clinicId, clinic.clinicCode]),
  );
}

export async function resolveAgentClinicContext(params: {
  user?: SessionUser;
  clinicId: string;
  clinicCode?: string;
  authorizationHeader?: string;
}, dependencies: { lookupClinicCode?: AgentClinicCodeLookup } = {}): Promise<AgentClinicContext> {
  if (!params.user) {
    throw new HttpError(401, "User session is required.");
  }

  if (!params.user.clinicIds.includes(params.clinicId)) {
    throw new HttpError(403, "You do not have access to this clinic.");
  }

  const trustedClinicCode = await (dependencies.lookupClinicCode ?? lookupAgentClinicCode)({
    clinicId: params.clinicId,
    authorizationHeader: params.authorizationHeader,
  });

  if (!trustedClinicCode) {
    throw new HttpError(403, "Unable to resolve an authorized clinic code for this clinic.");
  }

  const requestedClinicCode = params.clinicCode?.trim();
  if (requestedClinicCode && requestedClinicCode.toLowerCase() !== trustedClinicCode.toLowerCase()) {
    throw new HttpError(403, "The requested clinic code does not match the authorized clinic.");
  }

  return {
    clinicId: params.clinicId,
    clinicCode: trustedClinicCode,
  };
}
