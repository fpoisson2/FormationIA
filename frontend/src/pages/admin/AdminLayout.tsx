import { useMemo } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";

import logoPrincipal from "../../assets/logo_principal.svg";
import { useAdminAuth } from "../../providers/AdminAuthProvider";

const NAV_LINKS = [
  { to: "/admin/platforms", label: "Plateformes LTI" },
  { to: "/admin/lti-users", label: "Utilisateurs LTI" },
  { to: "/admin/local-users", label: "Comptes internes" },
];

export function AdminLayout(): JSX.Element {
  const { user, logout, isProcessing, expiresAt } = useAdminAuth();
  const expirationDisplay = useMemo(() => {
    if (!expiresAt) {
      return null;
    }
    const parsed = new Date(expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toLocaleString();
  }, [expiresAt]);

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-10 px-6 py-10 text-[color:var(--brand-black)]">
      <header className="space-y-6 rounded-3xl border border-white/60 bg-white/95 p-8 shadow-lg backdrop-blur">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-4 text-sm text-[color:var(--brand-charcoal)]/90 sm:text-base">
            <div className="flex items-center gap-4">
              <img src={logoPrincipal} alt="Cégep Limoilou" className="h-10 w-auto sm:h-12" />
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-[color:var(--brand-charcoal)]/60">
                  Espace administrateur
                </p>
                <h1 className="text-2xl font-semibold text-[color:var(--brand-black)] sm:text-3xl">Formation IA</h1>
              </div>
            </div>
            <p>
              Gérez les plateformes LTI, les comptes locaux et consultez l’activité des utilisateurs connectés.
            </p>
            <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
              {user ? <span>Connecté en tant que {user.username}</span> : null}
              {expirationDisplay ? <span>Expiration : {expirationDisplay}</span> : null}
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-3 text-sm sm:flex-row sm:items-center">
            <Link
              to="/activites"
              className="inline-flex items-center justify-center rounded-full border border-[color:var(--brand-charcoal)]/20 px-4 py-2 font-medium text-[color:var(--brand-charcoal)] transition hover:border-[color:var(--brand-red)]/40 hover:text-[color:var(--brand-red)]"
            >
              ← Retour aux activités
            </Link>
            <button
              type="button"
              onClick={() => {
                void logout();
              }}
              disabled={isProcessing}
              className="inline-flex items-center justify-center rounded-full bg-[color:var(--brand-red)] px-4 py-2 font-semibold text-white shadow-sm transition hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-red-400"
            >
              Se déconnecter
            </button>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-4 rounded-3xl border border-white/60 bg-white/95 p-6 shadow-md backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
            Navigation
          </p>
          <nav className="flex flex-col gap-2 text-sm">
            {NAV_LINKS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-full px-4 py-2 font-medium transition ${
                    isActive
                      ? "bg-[color:var(--brand-red)] text-white shadow"
                      : "bg-white/70 text-[color:var(--brand-charcoal)] hover:bg-white"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="rounded-2xl bg-[color:var(--brand-sand)]/80 p-4 text-xs text-[color:var(--brand-charcoal)]/80">
            <p className="font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">Conseil</p>
            <p className="mt-2 leading-relaxed">
              Les mises à jour sont sauvegardées immédiatement. Rafraîchis la page si les informations semblent périmées.
            </p>
          </div>
        </aside>
        <section className="rounded-3xl border border-white/60 bg-white/95 p-6 shadow-lg backdrop-blur">
          <Outlet />
        </section>
      </div>
    </div>
  );
}
