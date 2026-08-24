import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, tokens } from "../lib/api.ts";
import type { AuthProviders, Me } from "../lib/types.ts";

interface AuthValue {
  me: Me | null;
  providers: AuthProviders | null;
  loading: boolean;
  refresh: () => Promise<void>;
  loginAsGuest: (input: { name?: string; email?: string; timeZone?: string }) => Promise<Me>;
  logout: () => Promise<void>;
  setMe: (me: Me) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<Me | null>(null);
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!tokens.access()) {
      setMeState(null);
      setLoading(false);
      return;
    }
    try {
      setMeState(await api.get<Me>("/v2/me"));
    } catch {
      tokens.clear();
      setMeState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void api
      .get<AuthProviders>("/v2/auth/providers", undefined, { auth: false })
      .then(setProviders)
      .catch(() => setProviders(null));
    void refresh();
  }, [refresh]);

  const loginAsGuest = useCallback(
    async (input: { name?: string; email?: string; timeZone?: string }) => {
      const result = await api.post<{
        accessToken: string;
        refreshToken: string;
      }>("/v2/auth/guest", input, { auth: false });
      tokens.set(result.accessToken, result.refreshToken);
      const profile = await api.get<Me>("/v2/me");
      setMeState(profile);
      return profile;
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/v2/auth/logout", { refreshToken: tokens.refresh() });
    } catch {
      // Ignore: clearing local tokens is what matters.
    }
    tokens.clear();
    setMeState(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ me, providers, loading, refresh, loginAsGuest, logout, setMe: setMeState }),
    [me, providers, loading, refresh, loginAsGuest, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

export function useTimeFormat(): 12 | 24 {
  const { me } = useAuth();
  return me?.timeFormat === 24 ? 24 : 12;
}
