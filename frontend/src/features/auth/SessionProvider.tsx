import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import {
  onAuthStateChanged,
  signInWithCustomToken,
  signOut,
  type User,
} from "firebase/auth";
import { auth } from "../../lib/firebase";
import type { GTUserClaim } from "../../types/domain";
import { apiClient } from "../../api/http";

type SessionContextValue = {
  firebaseUser: User | null;
  gtUser: GTUserClaim | null;
  loading: boolean;
  signInWithGoogleCredential: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

function normalizeClinics(value: unknown): string[] {
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

function normalizeClaims(claims: Record<string, unknown>): GTUserClaim {
  return {
    email: typeof claims.email === "string" ? claims.email : undefined,
    name: typeof claims.name === "string" ? claims.name : undefined,
    photo: typeof claims.photo === "string" ? claims.photo : undefined,
    userId: typeof claims.userId === "string" ? claims.userId : undefined,
    roles: Array.isArray(claims.roles)
      ? claims.roles.filter((entry): entry is string => typeof entry === "string")
      : [],
    clinics: normalizeClinics(claims.clinics),
  };
}

export function SessionProvider({ children }: PropsWithChildren) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [gtUser, setGtUser] = useState<GTUserClaim | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);

      if (!user) {
        setGtUser(null);
        setLoading(false);
        return;
      }

      const tokenResult = await user.getIdTokenResult();
      setGtUser(normalizeClaims(tokenResult.claims));
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const signInWithGoogleCredential = useCallback(async (credential: string) => {
    const response = await apiClient.post<{ success: true; data: { customToken: string } }>(
      "/auth/google",
      { credential },
    );

    await signInWithCustomToken(auth, response.data.data.customToken);
  }, []);

  const logout = useCallback(async () => {
    localStorage.removeItem("gt_v2report.access");
    await signOut(auth);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      firebaseUser,
      gtUser,
      loading,
      signInWithGoogleCredential,
      logout,
    }),
    [firebaseUser, gtUser, loading, signInWithGoogleCredential, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used within SessionProvider.");
  }
  return value;
}

