import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useApolloClient } from "@apollo/client";
import type { Business, Clinic } from "../../types/domain";
import { useSession } from "../auth/SessionProvider";
import { GET_ALLOWED_CLINICS } from "./queries";

type AccessContextValue = {
  loading: boolean;
  error: string | null;
  clinics: Clinic[];
  canSwitchClinics: boolean;
  currentBusiness: Business | null;
  currentClinic: Clinic | null;
  selectClinic: (clinicId: string) => void;
};

const STORAGE_KEY = "gt_v2report.access";
const PREFERRED_BUSINESS_NAME = "alifestyle";
const BUSINESS_DISPLAY_NAME_MAP: Record<string, string> = {
  alifestyle: "LifeStyle",
};

const AccessContext = createContext<AccessContextValue | null>(null);

function sortClinics(clinics: Clinic[]) {
  return [...clinics].sort((left, right) => {
    const businessCompare = left.company.name.localeCompare(right.company.name);
    if (businessCompare !== 0) {
      return businessCompare;
    }
    return left.name.localeCompare(right.name);
  });
}

function buildBusinesses(clinics: Clinic[]): Business[] {
  const map = new Map<string, Business>();

  clinics.forEach((clinic) => {
    const business = map.get(clinic.company_id);
    if (business) {
      business.clinics.push(clinic);
      return;
    }

    map.set(clinic.company_id, {
      id: clinic.company_id,
      name: getBusinessDisplayName(clinic.company.name),
      clinics: [clinic],
    });
  });

  return [...map.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function readPersistedSelection() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as { businessId?: string; clinicId?: string };
  } catch {
    return null;
  }
}

function normalizeBusinessName(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getBusinessDisplayName(value: string | null | undefined) {
  const normalized = normalizeBusinessName(value);
  return BUSINESS_DISPLAY_NAME_MAP[normalized] ?? value ?? "";
}

function getPreferredBusiness(businesses: Business[]) {
  return (
    businesses.find((business) => normalizeBusinessName(business.name) === PREFERRED_BUSINESS_NAME) ??
    businesses[0] ??
    null
  );
}

function getInitialSelection(clinics: Clinic[], businesses: Business[]) {
  const persisted = readPersistedSelection();
  const preferredBusiness =
    getPreferredBusiness(businesses) ??
    (persisted?.businessId
      ? businesses.find((business) => business.id === persisted.businessId) ?? null
      : null);
  const persistedClinic = clinics.find((clinic) => clinic.id === persisted?.clinicId) ?? null;

  if (persistedClinic && persistedClinic.company_id === preferredBusiness?.id) {
    return {
      business: preferredBusiness,
      clinic: persistedClinic,
    };
  }

  const preferredClinic = preferredBusiness?.clinics[0] ?? clinics[0] ?? null;

  return {
    business: preferredBusiness,
    clinic: preferredClinic,
  };
}

function writePersistedSelection(businessId: string | undefined, clinicId: string | undefined) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      businessId,
      clinicId,
    }),
  );
}

export function AccessProvider({ children }: PropsWithChildren) {
  const client = useApolloClient();
  const { gtUser, firebaseUser } = useSession();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [currentClinicId, setCurrentClinicId] = useState<string | null>(null);

  useEffect(() => {
    const loadClinics = async () => {
      if (!firebaseUser || !gtUser) {
        setClinics([]);
        setCurrentClinicId(null);
        setError(null);
        setLoading(false);
        return;
      }

      if (gtUser.clinics.length === 0) {
        setClinics([]);
        setCurrentClinicId(null);
        setError("This account does not have any clinic access.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const result = await client.query<{ clinics: Clinic[] }>({
          query: GET_ALLOWED_CLINICS,
          variables: {
            where: {
              id: {
                in: gtUser.clinics,
              },
            },
          },
          fetchPolicy: "network-only",
        });

        const nextClinics = sortClinics(result.data.clinics ?? []);
        const businesses = buildBusinesses(nextClinics);
        const { business: nextBusiness, clinic: nextClinic } = getInitialSelection(nextClinics, businesses);

        setClinics(nextClinics);
        setCurrentClinicId(nextClinic?.id ?? null);
        writePersistedSelection(nextBusiness?.id, nextClinic?.id);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load allowed clinics.");
      } finally {
        setLoading(false);
      }
    };

    void loadClinics();
  }, [client, firebaseUser, gtUser]);

  const businesses = useMemo(() => buildBusinesses(clinics), [clinics]);
  const preferredBusiness = useMemo(() => getPreferredBusiness(businesses), [businesses]);
  const currentBusiness = useMemo(
    () => {
      const selectedClinic = clinics.find((clinic) => clinic.id === currentClinicId) ?? null;
      if (selectedClinic) {
        return businesses.find((business) => business.id === selectedClinic.company_id) ?? null;
      }

      return preferredBusiness;
    },
    [businesses, clinics, currentClinicId, preferredBusiness],
  );
  const currentClinic = useMemo(
    () => clinics.find((clinic) => clinic.id === currentClinicId) ?? null,
    [clinics, currentClinicId],
  );

  const value = useMemo<AccessContextValue>(
    () => ({
      loading,
      error,
      clinics,
      canSwitchClinics: (currentBusiness?.clinics.length ?? 0) > 1,
      currentBusiness,
      currentClinic,
      selectClinic: (clinicId: string) => {
        const nextClinic = clinics.find((clinic) => clinic.id === clinicId);
        if (!nextClinic) {
          return;
        }

        setCurrentClinicId(nextClinic.id);
        writePersistedSelection(nextClinic.company_id, nextClinic.id);
      },
    }),
    [loading, error, clinics, currentBusiness, currentClinic],
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess() {
  const value = useContext(AccessContext);
  if (!value) {
    throw new Error("useAccess must be used within AccessProvider.");
  }
  return value;
}
