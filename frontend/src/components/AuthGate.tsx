import { ReactNode, useEffect, useState } from "react";

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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[color:var(--brand-black)] via-[#1e1e2f] to-[color:var(--brand-red)] p-4">
      <div className="w-full max-w-md rounded-3xl bg-white/90 p-8 shadow-xl backdrop-blur">
        <div className="mb-6 flex flex-col gap-2 text-center">
          <span className="text-xs uppercase tracking-[0.4em] text-[color:var(--brand-red)]">Accès réservé</span>
          <h1 className="text-2xl font-semibold text-[color:var(--brand-black)]">Connexion à l’atelier</h1>
          <p className="text-sm text-[color:var(--brand-charcoal)]">
            Entrez les identifiants fournis pour accéder à l’expérience interactive.
          </p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
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
