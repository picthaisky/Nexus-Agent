import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "nexus.apiKey";

interface AuthContextValue {
  apiKey: string | null;
  setApiKey: (key: string | null) => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [apiKey, setApiKeyState] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const setApiKey = useCallback((key: string | null) => {
    setApiKeyState(key);
    try {
      if (key) window.localStorage.setItem(STORAGE_KEY, key);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore quota errors */
    }
  }, []);

  // Expose for fetch helpers
  useEffect(() => {
    (window as unknown as { __NEXUS_API_KEY__?: string | null }).__NEXUS_API_KEY__ = apiKey;
  }, [apiKey]);

  const value = useMemo(
    () => ({ apiKey, setApiKey, isAuthenticated: !!apiKey }),
    [apiKey, setApiKey],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Inject the stored API key into every fetch automatically. */
export function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const key = (window as unknown as { __NEXUS_API_KEY__?: string | null }).__NEXUS_API_KEY__;
  const headers = new Headers(init.headers);
  if (key) headers.set("X-API-Key", key);
  return fetch(input, { ...init, headers });
}
