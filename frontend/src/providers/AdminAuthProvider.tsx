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
  isEditMode: boolean;
  isTestMode: boolean;
  login: (
    payload: AdminLoginPayload
  ) => Promise<{ ok: true; user: AdminUser } | { ok: false; error: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  applySession: (session: AdminSession) => void;
  startTestSession: () => AdminSession | null;
  setEditMode: (enabled: boolean) => void;
}

const STORAGE_KEY = "formationia.admin.session";
const rawTestMode = import.meta.env?.VITE_ADMIN_TEST_MODE;
const isAdminTestMode =
  typeof rawTestMode === "string" &&
  ["1", "true", "on", "yes"].includes(rawTestMode.toLowerCase());

const TEST_SESSION_BLUEPRINT: AdminSession = {
  token: "__admin_test_mode__",
  expiresAt: null,
  user: {
    username: "demo-admin",
    roles: ["admin"],
    isActive: true,
    fromEnv: true,
  },
};

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
  const stored = useMemo(() => (isAdminTestMode ? null : readStoredSession()), []);
  const [status, setStatus] = useState<AdminAuthStatus>(
    isAdminTestMode ? "unauthenticated" : "loading"
  );
  const [user, setUser] = useState<AdminUser | null>(null);
  const [token, setToken] = useState<string | null>(
    isAdminTestMode ? null : stored?.token ?? null
  );
  const [expiresAt, setExpiresAt] = useState<string | null>(
    isAdminTestMode ? null : stored?.expiresAt ?? null
  );
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);

  const tokenRef = useRef<string | null>(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const applySession = useCallback((session: AdminSession) => {
    setUser(session.user);
    setToken(session.token);
    setExpiresAt(session.expiresAt ?? null);
    setStatus("authenticated");
    setError(null);
    if (isAdminTestMode) {
      return;
    }
    if (session.token) {
      persistSession({ token: session.token, expiresAt: session.expiresAt ?? null });
    } else {
      persistSession(null);
    }
  }, []);

  useEffect(() => {
    if (isAdminTestMode) {
      setStatus("unauthenticated");
      setUser(null);
      setToken(null);
      setExpiresAt(null);
      setError(null);
      return () => undefined;
    }

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
        if (isAdminTestMode) {
          const session: AdminSession = {
            ...TEST_SESSION_BLUEPRINT,
            token: TEST_SESSION_BLUEPRINT.token,
            user: {
              ...TEST_SESSION_BLUEPRINT.user,
              username:
                payload.username.trim() || TEST_SESSION_BLUEPRINT.user.username,
            },
          };
          applySession(session);
          return { ok: true, user: session.user } as const;
        }

        const response: AdminAuthResponse = await admin.auth.login(payload);
        const session: AdminSession = {
          token: response.token,
          expiresAt: response.expiresAt ?? null,
          user: response.user,
        };
        applySession(session);
        return { ok: true, user: response.user } as const;
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
      if (!isAdminTestMode) {
        await admin.auth.logout(tokenRef.current);
      }
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
      if (isAdminTestMode) {
        const session: AdminSession = {
          ...TEST_SESSION_BLUEPRINT,
          token: TEST_SESSION_BLUEPRINT.token,
        };
        applySession(session);
        return;
      }

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

  const startTestSession = useCallback(() => {
    if (!isAdminTestMode) {
      return null;
    }
    setIsProcessing(true);
    const session: AdminSession = {
      ...TEST_SESSION_BLUEPRINT,
      token: TEST_SESSION_BLUEPRINT.token,
    };
    applySession(session);
    setIsProcessing(false);
    return session;
  }, [applySession]);

  const setEditMode = useCallback((enabled: boolean) => {
    setIsEditMode(enabled);
  }, []);

  const value = useMemo<AdminAuthContextValue>(
    () => ({
      status,
      user,
      token,
      expiresAt,
      error,
      isProcessing,
      isEditMode,
      isTestMode: isAdminTestMode,
      login,
      logout,
      refresh,
      applySession,
      startTestSession,
      setEditMode,
    }),
    [
      status,
      user,
      token,
      expiresAt,
      error,
      isProcessing,
      isEditMode,
      login,
      logout,
      refresh,
      applySession,
      startTestSession,
      setEditMode,
    ]
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
