import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Minimal .env loader so we stay dependency free.
function loadDotEnv(): void {
  for (const candidate of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")]) {
    let raw: string;
    try {
      raw = readFileSync(candidate, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
    return;
  }
}

loadDotEnv();

function str(key: string, fallback?: string): string {
  const value = process.env[key];
  if (value === undefined || value === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var ${key}`);
  }
  return value;
}

function bool(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function num(key: string, fallback: number): number {
  const value = process.env[key];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) throw new Error(`Env var ${key} must be a number`);
  return parsed;
}

function requiredInProduction(key: string, devFallback: string): string {
  const value = process.env[key];
  if (value === undefined || value === "") {
    if ((process.env.NODE_ENV ?? "development") === "production") {
      throw new Error(`${key} must be set explicitly when NODE_ENV=production`);
    }
    return devFallback;
  }
  return value;
}

export const env = {
  databaseUrl: str("DATABASE_URL", "postgres://cal:cal@localhost:5432/cal"),
  apiPort: num("API_PORT", 3001),
  apiOrigin: str("API_ORIGIN", "http://localhost:3001"),
  webOrigin: str("WEB_ORIGIN", "http://localhost:5173"),

  // The dev fallback is a known value, so production must supply its own.
  jwtSecret: requiredInProduction("JWT_SECRET", "dev-secret-change-me-dev-secret-change-me"),
  accessTokenTtl: str("ACCESS_TOKEN_TTL", "15m"),
  refreshTokenTtl: str("REFRESH_TOKEN_TTL", "30d"),

  oidc: {
    enabled: bool("AUTH_OIDC_ENABLED", false),
    issuer: process.env.OIDC_ISSUER ?? "",
    clientId: process.env.OIDC_CLIENT_ID ?? "",
    clientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
    redirectUri: str("OIDC_REDIRECT_URI", "http://localhost:3001/v2/auth/oidc/callback"),
    scopes: str("OIDC_SCOPES", "openid profile email"),
    postLogoutRedirectUri: str("OIDC_POST_LOGOUT_REDIRECT_URI", "http://localhost:5173/auth/login"),
  },

  guest: {
    enabled: bool("AUTH_GUEST_ENABLED", true),
    autoCreate: bool("GUEST_AUTO_CREATE", true),
  },

  // There is no mail transport in this build. Turning this on returns the
  // verification code in the API response so the flow can be exercised locally —
  // it defeats email verification, so it must stay off anywhere real.
  exposeVerificationCodes: bool("EXPOSE_VERIFICATION_CODES", false),

  // Webhook subscriber URLs are user-supplied and fetched by the server, so
  // private address space is refused unless a deployment opts in.
  allowPrivateWebhookTargets: bool("ALLOW_PRIVATE_WEBHOOK_TARGETS", false),

  production: (process.env.NODE_ENV ?? "development") === "production",

  // When true the API also serves the built web app, so one process/container is
  // enough to host everything.
  serveWeb: bool("SERVE_WEB", false),
  webDist: str("WEB_DIST", "web/dist"),
} as const;

/** Duration strings like `15m`, `30d`, `900` (seconds) to seconds. */
export function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])?$/.exec(ttl.trim());
  if (!match) throw new Error(`Invalid TTL: ${ttl}`);
  const value = Number(match[1]);
  switch (match[2]) {
    case "m":
      return value * 60;
    case "h":
      return value * 3600;
    case "d":
      return value * 86400;
    default:
      return value;
  }
}
