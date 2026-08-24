// Zitadel (or any OIDC provider) authorization-code + PKCE login.
// The instance is hosted elsewhere; everything here is driven by env vars.

import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../env.ts";
import { badRequest, forbidden } from "../http/errors.ts";

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
}

let discoveryCache: { at: number; value: Discovery } | null = null;
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export function assertOidcEnabled(): void {
  if (!env.oidc.enabled) throw forbidden("OIDC login is disabled");
  if (!env.oidc.issuer || !env.oidc.clientId) {
    throw forbidden("OIDC login is enabled but OIDC_ISSUER/OIDC_CLIENT_ID are not configured");
  }
}

export async function discover(): Promise<Discovery> {
  assertOidcEnabled();
  const fresh = discoveryCache && Date.now() - discoveryCache.at < 10 * 60_000;
  if (fresh) return discoveryCache!.value;

  const url = `${env.oidc.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw badRequest(`OIDC discovery failed (${response.status}) for ${url}`);
  }
  const value = (await response.json()) as Discovery;
  discoveryCache = { at: Date.now(), value };
  jwks = createRemoteJWKSet(new URL(value.jwks_uri));
  return value;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function createPkce(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function authorizeUrl(state: string, challenge: string): Promise<string> {
  const discovery = await discover();
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("client_id", env.oidc.clientId);
  url.searchParams.set("redirect_uri", env.oidc.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", env.oidc.scopes);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface OidcProfile {
  subject: string;
  email: string;
  name: string;
  picture?: string;
  zoneinfo?: string;
}

export async function exchangeCode(code: string, verifier: string): Promise<OidcProfile> {
  const discovery = await discover();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.oidc.redirectUri,
    client_id: env.oidc.clientId,
    code_verifier: verifier,
  });
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  // Confidential clients authenticate with basic auth; public clients use PKCE alone.
  if (env.oidc.clientSecret) {
    const basic = Buffer.from(`${env.oidc.clientId}:${env.oidc.clientSecret}`).toString("base64");
    headers.authorization = `Basic ${basic}`;
  }

  const response = await fetch(discovery.token_endpoint, { method: "POST", headers, body });
  const payload = (await response.json()) as {
    id_token?: string;
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.id_token) {
    throw badRequest(
      `Token exchange failed: ${payload.error_description ?? payload.error ?? response.status}`
    );
  }

  if (!jwks) jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
  const { payload: claims } = await jwtVerify(payload.id_token, jwks, {
    issuer: discovery.issuer,
    audience: env.oidc.clientId,
  });

  let email = typeof claims.email === "string" ? claims.email : "";
  let name = typeof claims.name === "string" ? claims.name : "";
  let picture = typeof claims.picture === "string" ? claims.picture : undefined;

  // Zitadel omits profile claims from the id_token unless requested; fall back to userinfo.
  if ((!email || !name) && discovery.userinfo_endpoint && payload.access_token) {
    const info = await fetch(discovery.userinfo_endpoint, {
      headers: { authorization: `Bearer ${payload.access_token}`, accept: "application/json" },
    });
    if (info.ok) {
      const profile = (await info.json()) as Record<string, unknown>;
      email = email || (typeof profile.email === "string" ? profile.email : "");
      name = name || (typeof profile.name === "string" ? profile.name : "");
      picture = picture ?? (typeof profile.picture === "string" ? profile.picture : undefined);
    }
  }

  if (!email) throw badRequest("OIDC provider did not return an email address");

  return {
    subject: String(claims.sub),
    email,
    name: name || email.split("@")[0],
    picture,
    zoneinfo: typeof claims.zoneinfo === "string" ? claims.zoneinfo : undefined,
  };
}

export async function endSessionUrl(): Promise<string | null> {
  if (!env.oidc.enabled) return null;
  const discovery = await discover();
  if (!discovery.end_session_endpoint) return null;
  const url = new URL(discovery.end_session_endpoint);
  url.searchParams.set("post_logout_redirect_uri", env.oidc.postLogoutRedirectUri);
  url.searchParams.set("client_id", env.oidc.clientId);
  return url.toString();
}
