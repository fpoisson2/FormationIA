import { FormEvent, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import logoPrincipal from "../assets/logo_principal.svg";
import { AdminSkeleton } from "../components/admin/AdminSkeleton";
import { useAdminAuth } from "../providers/AdminAuthProvider";

const ADMIN_ROLES = ["admin", "superadmin", "administrator"];
const USER_ROLES = ["usager", "user", "participant", "learner", "etudiant", "étudiant"];

interface LocationState {
  from?: string;
}

const normaliseRoles = (roles: string[] | undefined | null): string[] =>
  (roles ?? []).map((role) => role.toLowerCase().trim());

const hasRole = (roles: string[], allowed: string[]): boolean =>
  roles.some((role) => allowed.includes(role));

const canAccessAdmin = (roles: string[]): boolean => hasRole(roles, ADMIN_ROLES);

const canAccessActivities = (roles: string[]): boolean =>
  canAccessAdmin(roles) || hasRole(roles, USER_ROLES);

const resolveDestination = (desired: string | undefined, roles: string[]): string | null => {
  if (desired && desired.startsWith("/")) {
    if (desired.startsWith("/admin")) {
      return canAccessAdmin(roles) ? desired : null;
    }
    return canAccessActivities(roles) ? desired : null;
  }

  if (canAccessAdmin(roles)) {
    return "/admin";
  }

  if (canAccessActivities(roles)) {
    return "/activites";
  }

  return null;
};

const normalizeErrorMessage = (error: string): string => {
  if (error.includes("Authentification administrateur requise")) {
    return "Identifiants incorrects ou compte sans les permissions nécessaires.";
  }
  if (error.includes("Invalid credentials") || error.includes("Identifiants invalides")) {
    return "Nom d'utilisateur ou mot de passe incorrect.";
  }
  if (error.includes("detail")) {
    try {
      const parsed = JSON.parse(error);
      if (parsed.detail?.includes("Authentification administrateur requise")) {
        return "Identifiants incorrects ou compte sans les permissions nécessaires.";
      }
      return parsed.detail || error;
    } catch {
      return error;
    }
  }
  return error;
};

export function LoginPage(): JSX.Element {
  const { status, login, error, isProcessing, user, logout } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const state = location.state as LocationState | null;
  const desiredPath = state?.from;

  const roles = useMemo(() => normaliseRoles(user?.roles), [user?.roles]);

  const redirectIfAuthenticated = useMemo(() => {
    if (status !== "authenticated") {
      return null;
    }
    return resolveDestination(desiredPath, roles);
  }, [desiredPath, roles, status]);

  if (status === "loading") {
    return (
      <div className="auth-background landing-gradient flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white/90 p-8 shadow-2xl backdrop-blur">
          <p className="text-sm font-medium text-[color:var(--brand-charcoal)]/80">
            Vérification de ta session…
          </p>
          <div className="mt-4">
            <AdminSkeleton lines={4} />
          </div>
        </div>
      </div>
    );
  }

  const combinedError = formError ?? error;

  if (status === "authenticated") {
    if (redirectIfAuthenticated) {
      return <Navigate to={redirectIfAuthenticated} replace />;
    }

    return (
      <div className="auth-background landing-gradient flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md animate-fade-in-up rounded-3xl border border-white/80 bg-white/95 p-8 text-center shadow-2xl backdrop-blur">
          <div className="space-y-4">
            <img src={logoPrincipal} alt="Cégep Limoilou" className="mx-auto h-12 w-auto filter brightness-0" />
            <h1 className="text-2xl font-semibold text-[color:var(--brand-black)]">Accès non autorisé</h1>
            <p className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
              Ton compte ne possède pas encore les rôles nécessaires pour accéder aux espaces protégés.
              Contacte un administrateur pour ajuster tes droits.
            </p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                className="w-full rounded-full bg-[color:var(--brand-red)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600"
                onClick={() => {
                  void logout();
                }}
              >
                Se déconnecter
              </button>
              <Link
                to="/"
                className="text-xs font-medium text-[color:var(--brand-red)] hover:underline"
              >
                Retour à l’accueil
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
      const nextRoles = normaliseRoles(result.user.roles);
      const destination = resolveDestination(desiredPath, nextRoles);
      if (destination) {
        navigate(destination, { replace: true });
      } else {
        setFormError(
          "Ton compte ne dispose pas des autorisations nécessaires. Contacte un administrateur pour obtenir un rôle."
        );
      }
    } else {
      setFormError(normalizeErrorMessage(result.error));
    }
  };

  return (
    <div className="auth-background landing-gradient flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-lg animate-fade-in-up rounded-3xl border border-white/70 bg-white/95 p-8 shadow-2xl backdrop-blur">
        <div className="flex flex-col gap-6 text-center">
          <div className="flex flex-col items-center gap-3 animate-float-soft">
            <img src={logoPrincipal} alt="Cégep Limoilou" className="h-12 w-auto filter brightness-0" />
            <span className="text-xs uppercase tracking-[0.4em] text-[color:var(--brand-red)]">
              Connexion Formation IA
            </span>
          </div>
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold text-[color:var(--brand-black)]">Identifie-toi</h1>
            <p className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
              Utilise ton compte local pour accéder aux activités ou à l’administration, selon tes rôles.
            </p>
          </div>
        </div>
        <div className="my-6 h-px bg-gradient-to-r from-transparent via-[color:var(--brand-charcoal)]/20 to-transparent" />
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="text-left">
            <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]" htmlFor="login-username">
              Nom d’utilisateur
            </label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-1 w-full rounded-full border border-white/60 bg-white/90 px-4 py-2 text-sm shadow-inner focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
              placeholder="Identifiant"
            />
          </div>
          <div className="text-left">
            <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]" htmlFor="login-password">
              Mot de passe
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-full border border-white/60 bg-white/90 px-4 py-2 text-sm shadow-inner focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
              placeholder="Mot de passe"
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
        <div className="mt-6 space-y-2 text-center text-xs text-[color:var(--brand-charcoal)]/70">
          <p>
            Accès Moodle ou autre plateforme ? Passez par votre cours pour une connexion LTI automatique.
          </p>
          <Link to="/" className="font-medium text-[color:var(--brand-red)] hover:underline">
            ← Retourner à l’accueil
          </Link>
        </div>
      </div>
    </div>
  );
}

