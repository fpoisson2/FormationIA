import { FormEvent, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import logoPrincipal from "../../assets/logo_principal.svg";
import { AdminSkeleton } from "../../components/admin/AdminSkeleton";
import { useAdminAuth } from "../../providers/AdminAuthProvider";

export function AdminLoginPage(): JSX.Element {
  const { status, login, error, isProcessing } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const redirectTo = useMemo(() => {
    const state = location.state as { from?: string } | undefined;
    return state?.from && state.from.startsWith("/admin") ? state.from : "/admin";
  }, [location.state]);

  if (status === "authenticated") {
    return <Navigate to={redirectTo} replace />;
  }

  if (status === "loading") {
    return (
      <div className="auth-background landing-gradient flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white/90 p-8 shadow-2xl backdrop-blur">
          <p className="text-sm font-medium text-[color:var(--brand-charcoal)]/80">
            Vérification de votre session administrateur…
          </p>
          <div className="mt-4">
            <AdminSkeleton lines={4} />
          </div>
        </div>
      </div>
    );
  }

  const combinedError = formError ?? error;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();
    if (!trimmedUsername || !trimmedPassword) {
      setFormError("Saisis un identifiant et un mot de passe.");
      return;
    }
    const result = await login({ username: trimmedUsername, password: trimmedPassword, remember });
    if (result.ok) {
      navigate(redirectTo, { replace: true });
    } else {
      setFormError(result.error);
    }
  };

  return (
    <div className="auth-background landing-gradient flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-lg animate-fade-in-up rounded-3xl border border-white/70 bg-white/95 p-8 shadow-2xl backdrop-blur">
        <div className="flex flex-col gap-6 text-center">
          <div className="flex flex-col items-center gap-3 animate-float-soft">
            <img src={logoPrincipal} alt="Cégep Limoilou" className="h-12 w-auto filter brightness-0" />
            <span className="text-xs uppercase tracking-[0.4em] text-[color:var(--brand-red)]">Administration</span>
          </div>
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold text-[color:var(--brand-black)]">Connexion administrateur</h1>
            <p className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
              Identifie-toi pour accéder aux paramètres avancés de Formation IA.
            </p>
          </div>
        </div>
        <div className="my-6 h-px bg-gradient-to-r from-transparent via-[color:var(--brand-charcoal)]/20 to-transparent" />
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="text-left">
            <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]" htmlFor="admin-username">
              Nom d’utilisateur
            </label>
            <input
              id="admin-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-1 w-full rounded-full border border-white/60 bg-white/90 px-4 py-2 text-sm shadow-inner focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
              placeholder="Identifiant administrateur"
            />
          </div>
          <div className="text-left">
            <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]" htmlFor="admin-password">
              Mot de passe
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-full border border-white/60 bg-white/90 px-4 py-2 text-sm shadow-inner focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
              placeholder="Mot de passe sécurisé"
            />
          </div>
          <label className="flex items-center gap-2 text-left text-xs text-[color:var(--brand-charcoal)]">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="h-4 w-4 rounded border-[color:var(--brand-charcoal)]/30 text-[color:var(--brand-red)] focus:ring-[color:var(--brand-red)]"
            />
            Se souvenir de moi sur cet appareil
          </label>
          {combinedError ? (
            <p className="rounded-3xl bg-red-50 p-3 text-xs text-red-600">{combinedError}</p>
          ) : null}
          <button
            type="submit"
            disabled={isProcessing}
            className="w-full rounded-full bg-[color:var(--brand-red)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-red-400"
          >
            {isProcessing ? "Connexion…" : "Se connecter"}
          </button>
        </form>
        <div className="mt-6 text-center text-xs text-[color:var(--brand-charcoal)]/70">
          <Link to="/activites" className="font-medium text-[color:var(--brand-red)] hover:underline">
            ← Retourner aux activités
          </Link>
        </div>
      </div>
    </div>
  );
}
