import { ReactNode, useEffect, useState } from "react";
import logoPrincipal from "../assets/logo_principal.svg";

const STORAGE_KEY = "formationia-auth";

interface AuthGateProps {
  children: ReactNode;
}

function AuthGate({ children }: AuthGateProps): JSX.Element {
  const expectedUsername = import.meta.env.VITE_LOGIN_USERNAME ?? "test";
  const expectedPassword = import.meta.env.VITE_LOGIN_PASSWORD ?? "Telecom2025$";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === "true") {
      setAuthenticated(true);
    }
  }, []);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (username.trim() === expectedUsername && password === expectedPassword) {
      localStorage.setItem(STORAGE_KEY, "true");
      setAuthenticated(true);
      setError(null);
    } else {
      setError("Identifiants invalides. Veuillez réessayer.");
      setPassword("");
    }
  };

  if (authenticated) {
    return <>{children}</>;
  }

  return (
    <div className="auth-background landing-gradient flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md animate-fade-in-up rounded-3xl bg-white/90 p-8 shadow-2xl shadow-black/10 backdrop-blur">
        <div className="flex flex-col gap-5 text-center">
          <div className="flex flex-col items-center gap-3 animate-float-soft">
            <img
              src={logoPrincipal}
              alt="Cégep Limoilou"
              className="h-12 w-auto filter brightness-0"
            />
            <span className="text-xs uppercase tracking-[0.4em] text-[color:var(--brand-red)]">
              Atelier Formation IA
            </span>
          </div>
          <div className="space-y-3 animate-fade-in-up-delayed">
            <h1 className="text-2xl font-semibold text-[color:var(--brand-black)]">Connexion</h1>
            <p className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
              Plongez dans un atelier guidé où vous testez deux profils IA, observez leurs différences en direct et repartez avec une synthèse claire. Identifiez-vous pour démarrer la démonstration.
            </p>
          </div>
        </div>
        <div className="my-6 h-px bg-gradient-to-r from-transparent via-[color:var(--brand-charcoal)]/20 to-transparent" />
        <form className="space-y-4 animate-fade-in-up-delayed" onSubmit={handleSubmit}>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]" htmlFor="username">
              Nom d’utilisateur
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-1 w-full rounded-full border border-white/60 bg-white/90 px-4 py-2 text-sm shadow-inner focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
              placeholder="Identifiant"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]" htmlFor="password">
              Mot de passe
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-full border border-white/60 bg-white/90 px-4 py-2 text-sm shadow-inner focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
              placeholder="Mot de passe"
            />
          </div>
          {error && <p className="rounded-2xl bg-red-50 p-3 text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-full bg-[color:var(--brand-red)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-300"
          >
            Se connecter
          </button>
        </form>
      </div>
    </div>
  );
}

export default AuthGate;
