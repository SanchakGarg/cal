import { useEffect, useState } from "react";
import { tokens } from "../lib/api.ts";
import { useAuth } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";

/** Reads the tokens the API put in the URL fragment after the OIDC round trip. */
export function AuthCallbackPage() {
  const { refresh } = useAuth();
  const { navigate } = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const isNewUser = params.get("new_user") === "true";

    if (!accessToken) {
      setError("Login response did not contain a token.");
      return;
    }
    tokens.set(accessToken, refreshToken ?? undefined);
    window.history.replaceState({}, "", "/auth/callback");
    void refresh().then(() => navigate(isNewUser ? "/getting-started" : "/event-types", { replace: true }));
  }, [refresh, navigate]);

  return (
    <div className="cal-auth">
      <div className="cal-auth__card cal-card">
        <h1>{error ? "Sign in failed" : "Signing you in…"}</h1>
        <p className="cal-muted">{error ?? "One moment while we finish the handshake."}</p>
      </div>
    </div>
  );
}
