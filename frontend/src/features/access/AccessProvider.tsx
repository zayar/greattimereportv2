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
  businesses: Business[];
  clinics: Clinic[];
  currentBusiness: Business | null;
  currentClinic: Clinic | null;
  selectBusiness: (businessId: string) => void;
  selectClinic: (clinicId: string) => void;
};

const STORAGE_KEY = "gt_v2report.access";

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
      name: clinic.company.name,
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
  const [currentBusinessId, setCurrentBusinessId] = useState<string | null>(null);
  const [currentClinicId, setCurrentClinicId] = useState<string | null>(null);

  useEffect(() => {
    const loadClinics = async () => {
      if (!firebaseUser || !gtUser) {
        setClinics([]);
        setCurrentBusinessId(null);
        setCurrentClinicId(null);
        setError(null);
        setLoading(false);
        return;
      }

      if (gtUser.clinics.length === 0) {
        setClinics([]);
        setCurrentBusinessId(null);
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
        const persisted = readPersistedSelection();

        let nextClinic = nextClinics.find((clinic) => clinic.id === persisted?.clinicId) ?? nextClinics[0] ?? null;
        let nextBusiness =
          businesses.find((business) => business.id === persisted?.businessId) ??
          (nextClinic
            ? businesses.find((business) => business.id === nextClinic.company_id)
            : businesses[0] ?? null);

        if (nextBusiness && nextClinic && nextClinic.company_id !== nextBusiness.id) {
          nextClinic = nextBusiness.clinics[0] ?? null;
        }

        setClinics(nextClinics);
        setCurrentBusinessId(nextBusiness?.id ?? null);
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
  const currentBusiness = useMemo(
    () => businesses.find((business) => business.id === currentBusinessId) ?? null,
    [businesses, currentBusinessId],
  );
  const currentClinic = useMemo(
    () => clinics.find((clinic) => clinic.id === currentClinicId) ?? null,
    [clinics, currentClinicId],
  );

  const value = useMemo<AccessContextValue>(
    () => ({
      loading,
      error,
      businesses,
      clinics,
      currentBusiness,
      currentClinic,
      selectBusiness: (businessId: string) => {
        const nextBusiness = businesses.find((business) => business.id === businessId);
        if (!nextBusiness) {
          return;
        }

        const clinicInBusiness =
          nextBusiness.clinics.find((clinic) => clinic.id === currentClinicId) ??
          nextBusiness.clinics[0] ??
          null;

        setCurrentBusinessId(nextBusiness.id);
        setCurrentClinicId(clinicInBusiness?.id ?? null);
        writePersistedSelection(nextBusiness.id, clinicInBusiness?.id);
      },
      selectClinic: (clinicId: string) => {
        const nextClinic = clinics.find((clinic) => clinic.id === clinicId);
        if (!nextClinic) {
          return;
        }

        setCurrentClinicId(nextClinic.id);
        setCurrentBusinessId(nextClinic.company_id);
        writePersistedSelection(nextClinic.company_id, nextClinic.id);
      },
    }),
    [loading, error, businesses, clinics, currentBusiness, currentClinic, currentClinicId],
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

