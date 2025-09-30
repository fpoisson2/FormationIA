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
  type CreatorSignupPayload,
  type StudentSignupPayload,
} from "../api";

type AdminAuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthAttemptResult =
  | { ok: true; user: AdminUser }
  | { ok: false; error: string };

interface StoredSession {
  token: string;
  expiresAt: string | null;
}

interface StoredTestSession {
  user: {
    username: string;
    roles: string[];
    isActive?: boolean;
    fromEnv?: boolean;
  };
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
  login: (payload: AdminLoginPayload) => Promise<AuthAttemptResult>;
  signupCreator: (payload: CreatorSignupPayload) => Promise<AuthAttemptResult>;
  signupStudent: (payload: StudentSignupPayload) => Promise<AuthAttemptResult>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  applySession: (session: AdminSession) => void;
  startTestSession: () => AdminSession | null;
  setEditMode: (enabled: boolean) => void;
}

const STORAGE_KEY = "formationia.admin.session";
const TEST_STORAGE_KEY = `${STORAGE_KEY}.test`;
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

function readStoredTestSession(): AdminSession | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(TEST_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredTestSession>;
    const storedUser = parsed?.user;
    if (!storedUser || typeof storedUser.username !== "string" || !Array.isArray(storedUser.roles)) {
      return null;
    }
    return {
      ...TEST_SESSION_BLUEPRINT,
      user: {
        ...TEST_SESSION_BLUEPRINT.user,
        username: storedUser.username.trim() || TEST_SESSION_BLUEPRINT.user.username,
        roles: storedUser.roles,
        isActive:
          typeof storedUser.isActive === "boolean"
            ? storedUser.isActive
            : TEST_SESSION_BLUEPRINT.user.isActive,
        fromEnv:
          typeof storedUser.fromEnv === "boolean"
            ? storedUser.fromEnv
            : TEST_SESSION_BLUEPRINT.user.fromEnv,
      },
    };
  } catch (error) {
    console.warn("Invalid admin test session in storage", error);
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

function persistTestSession(session: AdminSession | null): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (!session) {
      window.sessionStorage.removeItem(TEST_STORAGE_KEY);
      return;
    }
    const payload: StoredTestSession = {
      user: {
        username: session.user.username,
        roles: session.user.roles,
        isActive: session.user.isActive,
        fromEnv: session.user.fromEnv,
      },
    };
    window.sessionStorage.setItem(TEST_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("Unable to persist admin test session", error);
  }
}

interface AdminAuthProviderProps {
  children: ReactNode;
}

export function AdminAuthProvider({ children }: AdminAuthProviderProps): JSX.Element {
  const stored = useMemo(() => (isAdminTestMode ? null : readStoredSession()), []);
  const storedTestSession = useMemo(() => (isAdminTestMode ? readStoredTestSession() : null), []);
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
      persistTestSession(session.token === TEST_SESSION_BLUEPRINT.token ? session : null);
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
      if (storedTestSession) {
        applySession(storedTestSession);
      } else {
        setStatus("unauthenticated");
        setUser(null);
        setToken(null);
        setExpiresAt(null);
        setError(null);
      }
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
  }, [applySession, stored?.token, storedTestSession]);

  const login = useCallback(
    async (payload: AdminLoginPayload): Promise<AuthAttemptResult> => {
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

  const signupCreator = useCallback(
    async (payload: CreatorSignupPayload): Promise<AuthAttemptResult> => {
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
              roles: ["creator"],
              fromEnv: false,
              isActive: true,
            },
          };
          applySession(session);
          return { ok: true, user: session.user } as const;
        }

        const response: AdminAuthResponse = await admin.auth.signupCreator(payload);
        const session: AdminSession = {
          token: response.token,
          expiresAt: response.expiresAt ?? null,
          user: response.user,
        };
        applySession(session);
        return { ok: true, user: response.user } as const;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Impossible de créer le compte.";
        setUser(null);
        setToken(null);
        setExpiresAt(null);
        setStatus("unauthenticated");
        setError(message);
        persistSession(null);
        if (isAdminTestMode) {
          persistTestSession(null);
        }
        return { ok: false, error: message } as const;
      } finally {
        setIsProcessing(false);
      }
    },
    [applySession]
  );

  const signupStudent = useCallback(
    async (payload: StudentSignupPayload): Promise<AuthAttemptResult> => {
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
              roles: ["student"],
              fromEnv: false,
              isActive: true,
            },
          };
          applySession(session);
          return { ok: true, user: session.user } as const;
        }

        const response: AdminAuthResponse = await admin.auth.signupStudent(payload);
        const session: AdminSession = {
          token: response.token,
          expiresAt: response.expiresAt ?? null,
          user: response.user,
        };
        applySession(session);
        return { ok: true, user: response.user } as const;
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Impossible de créer le compte étudiant.";
        setUser(null);
        setToken(null);
        setExpiresAt(null);
        setStatus("unauthenticated");
        setError(message);
        persistSession(null);
        if (isAdminTestMode) {
          persistTestSession(null);
        }
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
      if (isAdminTestMode) {
        persistTestSession(null);
      }
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
      signupCreator,
      signupStudent,
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
      signupCreator,
      signupStudent,
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
