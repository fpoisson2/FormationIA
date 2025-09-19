import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  admin,
  type AdminAuthResponse,
  type AdminLoginPayload,
  type AdminMeResponse,
  type AdminSession,
  type AdminUser,
} from "../api";

type AdminAuthStatus = "loading" | "authenticated" | "unauthenticated";

interface StoredSession {
  token: string;
  expiresAt: string | null;
}

interface AdminAuthContextValue {
  status: AdminAuthStatus;
  user: AdminUser | null;
  token: string | null;
  expiresAt: string | null;
  error: string | null;
  isProcessing: boolean;
  login: (payload: AdminLoginPayload) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  applySession: (session: AdminSession) => void;
}

const STORAGE_KEY = "formationia.admin.session";

const AdminAuthContext = createContext<AdminAuthContextValue | undefined>(undefined);

function readStoredSession(): StoredSession | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (!parsed || typeof parsed.token !== "string" || parsed.token.length === 0) {
      return null;
    }
    return {
      token: parsed.token,
      expiresAt: typeof parsed.expiresAt === "string" ? parsed.expiresAt : null,
    };
  } catch (error) {
    console.warn("Invalid admin session in storage", error);
    return null;
  }
}

function persistSession(session: StoredSession | null): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (!session || !session.token) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch (error) {
    console.warn("Unable to persist admin session", error);
  }
}

interface AdminAuthProviderProps {
  children: ReactNode;
}

export function AdminAuthProvider({ children }: AdminAuthProviderProps): JSX.Element {
  const stored = useMemo(() => readStoredSession(), []);
  const [status, setStatus] = useState<AdminAuthStatus>("loading");
  const [user, setUser] = useState<AdminUser | null>(null);
  const [token, setToken] = useState<string | null>(stored?.token ?? null);
  const [expiresAt, setExpiresAt] = useState<string | null>(stored?.expiresAt ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const tokenRef = useRef<string | null>(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const applySession = useCallback(
    (session: AdminSession) => {
      setUser(session.user);
      setToken(session.token);
      setExpiresAt(session.expiresAt ?? null);
      setStatus("authenticated");
      setError(null);
      if (session.token) {
        persistSession({ token: session.token, expiresAt: session.expiresAt ?? null });
      } else {
        persistSession(null);
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      setStatus("loading");
      try {
        const response = await admin.auth.me(tokenRef.current);
        if (cancelled) {
          return;
        }
        const session: AdminSession = {
          token: tokenRef.current ?? stored?.token ?? null,
          expiresAt: response.expiresAt ?? null,
          user: response.user,
        };
        applySession(session);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setUser(null);
        setToken(null);
        setExpiresAt(null);
        setStatus("unauthenticated");
        const message = err instanceof Error ? err.message : "Session administrateur expirée.";
        setError(message);
        persistSession(null);
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [applySession, stored?.token]);

  const login = useCallback(
    async (payload: AdminLoginPayload) => {
      setIsProcessing(true);
      setError(null);
      try {
        const response: AdminAuthResponse = await admin.auth.login(payload);
        const session: AdminSession = {
          token: response.token,
          expiresAt: response.expiresAt ?? null,
          user: response.user,
        };
        applySession(session);
        return { ok: true } as const;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Impossible de se connecter.";
        setUser(null);
        setToken(null);
        setExpiresAt(null);
        setStatus("unauthenticated");
        setError(message);
        persistSession(null);
        return { ok: false, error: message } as const;
      } finally {
        setIsProcessing(false);
      }
    },
    [applySession]
  );

  const logout = useCallback(async () => {
    setIsProcessing(true);
    try {
      await admin.auth.logout(tokenRef.current);
    } catch (err) {
      console.warn("Failed to logout admin", err);
    } finally {
      setUser(null);
      setToken(null);
      setExpiresAt(null);
      setStatus("unauthenticated");
      setError(null);
      persistSession(null);
      setIsProcessing(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setIsProcessing(true);
    try {
      const response: AdminMeResponse = await admin.auth.me(tokenRef.current);
      const session: AdminSession = {
        token: tokenRef.current,
        expiresAt: response.expiresAt ?? null,
        user: response.user,
      };
      applySession(session);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Session administrateur expirée.";
      setError(message);
      setUser(null);
      setToken(null);
      setExpiresAt(null);
      setStatus("unauthenticated");
      persistSession(null);
    } finally {
      setIsProcessing(false);
    }
  }, [applySession]);

  const value = useMemo<AdminAuthContextValue>(
    () => ({
      status,
      user,
      token,
      expiresAt,
      error,
      isProcessing,
      login,
      logout,
      refresh,
      applySession,
    }),
    [status, user, token, expiresAt, error, isProcessing, login, logout, refresh, applySession]
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthContextValue {
  const context = useContext(AdminAuthContext);
  if (!context) {
    throw new Error("useAdminAuth doit être utilisé dans un AdminAuthProvider.");
  }
  return context;
}
