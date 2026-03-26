import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useSession } from "./SessionProvider";
import { ScreenLoader } from "../../components/StatusViews";

type Props = {
  children: ReactNode;
};

export function ProtectedRoute({ children }: Props) {
  const { firebaseUser, loading } = useSession();
  const location = useLocation();

  if (loading) {
    return <ScreenLoader label="Restoring your secure session..." />;
  }

  if (!firebaseUser) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
