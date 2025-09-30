import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useLTI } from "../hooks/useLTI";
import { useAdminAuth } from "../providers/AdminAuthProvider";

interface ActivityAccessGuardProps {
  children: ReactNode;
}

const USER_ROLES = [
  "usager",
  "user",
  "participant",
  "learner",
  "etudiant",
  "étudiant",
  "student",
  "creator",
  "creatrice",
  "créatrice",
];
const ADMIN_ROLES = ["admin", "superadmin", "administrator"];

const normaliseRoles = (roles: string[] | undefined | null): string[] =>
  (roles ?? []).map((role) => role.toLowerCase().trim());

const hasRole = (roles: string[], allowed: string[]): boolean =>
  roles.some((role) => allowed.includes(role));

const canAccessActivities = (roles: string[]): boolean =>
  hasRole(roles, ADMIN_ROLES) || hasRole(roles, USER_ROLES);

export function ActivityAccessGuard({ children }: ActivityAccessGuardProps): JSX.Element {
  const { isLTISession, loading: ltiLoading } = useLTI();
  const { status, user } = useAdminAuth();
  const location = useLocation();

  if (ltiLoading || status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[color:var(--brand-sand)]/40">
        <div className="w-full max-w-md rounded-3xl border border-white/60 bg-white/90 p-8 text-center shadow-xl backdrop-blur">
          <p className="text-sm font-medium text-[color:var(--brand-charcoal)]/80">
            Vérification de l'accès…
          </p>
        </div>
      </div>
    );
  }

  if (isLTISession) {
    return <>{children}</>;
  }

  if (status !== "authenticated") {
    return (
      <Navigate
        to="/connexion"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  const roles = normaliseRoles(user?.roles);
  if (!canAccessActivities(roles)) {
    return (
      <Navigate
        to="/connexion"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return <>{children}</>;
}

