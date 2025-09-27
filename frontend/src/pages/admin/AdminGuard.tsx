import { Navigate, Outlet, useLocation } from "react-router-dom";

import { AdminSkeleton } from "../../components/admin/AdminSkeleton";
import { useAdminAuth } from "../../providers/AdminAuthProvider";

const ADMIN_ROLES = ["admin", "superadmin", "administrator"];

const normaliseRoles = (roles: string[] | undefined | null): string[] =>
  (roles ?? []).map((role) => role.toLowerCase().trim());

const canAccessAdmin = (roles: string[]): boolean =>
  roles.some((role) => ADMIN_ROLES.includes(role));

export function AdminGuard(): JSX.Element {
  const { status, isProcessing, user } = useAdminAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[color:var(--brand-sand)]/40">
        <div className="w-full max-w-md rounded-3xl border border-white/60 bg-white/90 p-8 shadow-xl backdrop-blur">
          <p className="text-sm font-medium text-[color:var(--brand-charcoal)]/80">Chargement de l'espace administrateur…</p>
          <div className="mt-4">
            <AdminSkeleton lines={4} />
          </div>
        </div>
      </div>
    );
  }

  if (status !== "authenticated") {
    return (
      <Navigate
        to="/admin/connexion"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  const roles = normaliseRoles(user?.roles);
  if (!canAccessAdmin(roles)) {
    return (
      <Navigate
        to="/admin/connexion"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[color:var(--brand-sand)]/40">
      {isProcessing ? (
        <div className="fixed inset-x-0 top-0 z-40 h-1 bg-gradient-to-r from-[color:var(--brand-red)] via-transparent to-[color:var(--brand-red)] animate-pulse" />
      ) : null}
      <Outlet />
    </div>
  );
}
