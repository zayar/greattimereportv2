import { queryApicoreWithFallback } from "../apicore.service.js";
import type { AgentClinicContext } from "../agent-hub/types.js";

const CONSULTANT_SERVICE_CATALOG_QUERY = `
  query ConsultantServiceCatalog($clinicId: String!) {
    services(
      where: { clinic_id: { equals: $clinicId }, status: { equals: ACTIVE } }
      orderBy: [{ sort_order: asc }, { name: asc }]
      take: 250
    ) {
      id
      name
      description
      status
      price
      original_price
      duration
      sort_order
      updated_at
      clinic_id
    }
  }
`;

type ApicoreServiceRow = {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  status?: string | null;
  price?: unknown;
  original_price?: unknown;
  duration?: number | null;
  sort_order?: number | null;
  updated_at?: string | null;
  clinic_id?: string | null;
};

export type ConsultantCatalogService = {
  serviceId: string;
  serviceName: string;
  description: string | null;
  status: "ACTIVE";
  price: string;
  originalPrice: string;
  durationMinutes: number;
  sortOrder: number;
  updatedAt: string | null;
};

function decimalString(value: unknown) {
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }
  if (value && typeof value === "object" && "value" in value) {
    return decimalString((value as { value: unknown }).value);
  }
  return "0.00";
}

const catalogCache = new Map<string, { services: ConsultantCatalogService[]; expiresAt: number }>();
const CATALOG_CACHE_TTL_MS = 60_000;

export function clearConsultantCatalogCache() {
  catalogCache.clear();
}

export async function getConsultantServiceCatalog(params: {
  clinic: AgentClinicContext;
  authorizationHeader?: string;
}) {
  const cached = catalogCache.get(params.clinic.clinicId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.services;
  }

  const data = await queryApicoreWithFallback<{ services?: ApicoreServiceRow[] | null }>({
    query: CONSULTANT_SERVICE_CATALOG_QUERY,
    variables: { clinicId: params.clinic.clinicId },
    authorizationHeader: params.authorizationHeader,
    errorMessage: "Unable to load the current service catalog from GT API Core.",
    readOnly: true,
  });

  const services = (data?.services ?? [])
    .filter(
      (service): service is ApicoreServiceRow & { id: string; name: string } =>
        Boolean(
          service.id &&
            service.name &&
            service.status === "ACTIVE" &&
            service.clinic_id === params.clinic.clinicId,
        ),
    )
    .map((service) => ({
      serviceId: service.id,
      serviceName: service.name.trim(),
      description: service.description?.trim() || null,
      status: "ACTIVE" as const,
      price: decimalString(service.price),
      originalPrice: decimalString(service.original_price),
      durationMinutes: Math.max(0, Math.round(service.duration ?? 0)),
      sortOrder: Math.max(0, Math.round(service.sort_order ?? 0)),
      updatedAt: service.updated_at ?? null,
    }));

  catalogCache.set(params.clinic.clinicId, {
    services,
    expiresAt: Date.now() + CATALOG_CACHE_TTL_MS,
  });

  return services;
}

export const __test = {
  CONSULTANT_SERVICE_CATALOG_QUERY,
  decimalString,
};
