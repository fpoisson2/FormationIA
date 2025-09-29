import { FormEvent, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import logoPrincipal from "../assets/logo_principal.svg";
import { AdminSkeleton } from "../components/admin/AdminSkeleton";
import { useAdminAuth } from "../providers/AdminAuthProvider";

const ADMIN_ROLES = ["admin", "superadmin", "administrator"];
const STUDENT_ROLES = ["student", "etudiant", "étudiant"];
const CREATOR_ROLES = ["creator", "creatrice", "créatrice"];
const USER_ROLES = ["usager", "user", "participant", "learner", ...STUDENT_ROLES, ...CREATOR_ROLES];

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

export function StudentSignupPage(): JSX.Element {
  const { status, user, signupStudent, isProcessing, error } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [invitationCode, setInvitationCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const state = location.state as LocationState | null;
  const desiredPath = state?.from;

  const roles = useMemo(() => normaliseRoles(user?.roles), [user?.roles]);
  const redirectIfAuthenticated = useMemo(() => {
    if (status !== "authenticated") {
      return null;
    }
    return resolveDestination(desiredPath, roles) ?? "/activites";
  }, [desiredPath, roles, status]);

  if (status === "loading") {
    return (
      <div className="auth-background landing-gradient flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white/90 p-8 shadow-2xl backdrop-blur">
          <p className="text-sm font-medium text-[color:var(--brand-charcoal)]/80">
            Vérification de l'accès à l'inscription…
          </p>
          <div className="mt-4">
            <AdminSkeleton lines={4} />
          </div>
        </div>
      </div>
    );
  }

  const combinedError = formError ?? error;

  if (status === "authenticated" && redirectIfAuthenticated) {
    return <Navigate to={redirectIfAuthenticated} replace />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();
    const trimmedConfirm = confirmPassword.trim();
    const trimmedCode = invitationCode.trim();

    if (!trimmedUsername || !trimmedPassword || !trimmedCode) {
      setFormError("Renseigne ton adresse courriel, ton mot de passe et le code reçu.");
      return;
    }

    if (trimmedPassword.length < 8) {
      setFormError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }

    if (trimmedPassword !== trimmedConfirm) {
      setFormError("Les mots de passe saisis ne correspondent pas.");
      return;
    }

    const result = await signupStudent({
      username: trimmedUsername,
      password: trimmedPassword,
      invitationCode: trimmedCode,
    });

    if (result.ok) {
      const nextRoles = normaliseRoles(result.user.roles);
      const destination = resolveDestination(desiredPath, nextRoles) ?? "/activites";
      navigate(destination, { replace: true });
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
            <span className="text-xs uppercase tracking-[0.4em] text-[color:var(--brand-red)]">
              Inscription Étudiante
            </span>
          </div>
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold text-[color:var(--brand-black)]">Rejoins ton parcours</h1>
            <p className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
              Saisis le code d'invitation partagé par ton enseignante ou enseignant pour activer ton accès aux
              activités Formation IA.
            </p>
          </div>
          <form className="space-y-4" onSubmit={handleSubmit} noValidate>
            <div className="space-y-2 text-left">
              <label className="text-sm font-medium text-[color:var(--brand-charcoal)]" htmlFor="invitationCode">
                Code d'invitation
              </label>
              <input
                id="invitationCode"
                name="invitationCode"
                type="text"
                autoComplete="one-time-code"
                value={invitationCode}
                onChange={(event) => setInvitationCode(event.target.value)}
                className="w-full rounded-2xl border border-[color:var(--brand-charcoal)]/20 bg-white/80 px-4 py-3 text-sm shadow-inner focus:border-[color:var(--brand-red)] focus:outline-none"
                placeholder="Ex. FORM-2024-ABC"
                required
              />
            </div>
            <div className="space-y-2 text-left">
              <label className="text-sm font-medium text-[color:var(--brand-charcoal)]" htmlFor="username">
                Adresse courriel institutionnelle
              </label>
              <input
                id="username"
                name="username"
                type="email"
                autoComplete="email"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="w-full rounded-2xl border border-[color:var(--brand-charcoal)]/20 bg-white/80 px-4 py-3 text-sm shadow-inner focus:border-[color:var(--brand-red)] focus:outline-none"
                placeholder="prenom.nom@cegep.qc.ca"
                required
              />
            </div>
            <div className="grid gap-3 text-left sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-[color:var(--brand-charcoal)]" htmlFor="password">
                  Mot de passe
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-2xl border border-[color:var(--brand-charcoal)]/20 bg-white/80 px-4 py-3 text-sm shadow-inner focus:border-[color:var(--brand-red)] focus:outline-none"
                  placeholder="Minimum 8 caractères"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-[color:var(--brand-charcoal)]" htmlFor="confirmPassword">
                  Confirmation
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full rounded-2xl border border-[color:var(--brand-charcoal)]/20 bg-white/80 px-4 py-3 text-sm shadow-inner focus:border-[color:var(--brand-red)] focus:outline-none"
                  placeholder="Répète ton mot de passe"
                  required
                />
              </div>
            </div>
            {combinedError ? (
              <p className="text-sm font-medium text-red-600" role="alert">
                {combinedError}
              </p>
            ) : null}
            <button
              type="submit"
              className="w-full rounded-full bg-[color:var(--brand-red)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isProcessing}
            >
              {isProcessing ? "Activation en cours…" : "Activer mon compte"}
            </button>
          </form>
          <div className="space-y-2 text-sm text-[color:var(--brand-charcoal)]">
            <p>
              Tu es créatrice ou créateur d'activités ?
              <Link to="/inscription/createur" className="ml-1 font-semibold text-[color:var(--brand-red)] hover:underline">
                Inscris-toi sur l'espace dédié
              </Link>
            </p>
            <p>
              Déjà inscrit·e ?
              <Link to="/connexion" className="ml-1 font-semibold text-[color:var(--brand-red)] hover:underline">
                Reviens à la page de connexion
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default StudentSignupPage;
