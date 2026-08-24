import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env, ttlToSeconds } from "../env.ts";
import { query, queryOne } from "../db/pool.ts";
import { unauthorized } from "../http/errors.ts";

const secret = new TextEncoder().encode(env.jwtSecret);

export interface AccessTokenClaims {
  sub: string;
  username: string;
  email: string;
  orgId: number | null;
  isGuest: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: "Bearer";
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  const ttl = ttlToSeconds(env.accessTokenTtl);
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer(env.apiOrigin)
    .setSubject(claims.sub)
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttl)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: env.apiOrigin });
    return {
      sub: String(payload.sub),
      username: String(payload.username ?? ""),
      email: String(payload.email ?? ""),
      orgId: (payload.orgId as number | null) ?? null,
      isGuest: Boolean(payload.isGuest),
    };
  } catch {
    throw unauthorized("Invalid or expired access token");
  }
}

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export async function issueTokens(user: {
  id: number;
  username: string;
  email: string;
  organization_id: number | null;
  is_guest: boolean;
}): Promise<TokenPair> {
  const accessToken = await signAccessToken({
    sub: String(user.id),
    username: user.username,
    email: user.email,
    orgId: user.organization_id,
    isGuest: user.is_guest,
  });
  const refreshToken = randomBytes(48).toString("base64url");
  const refreshTtl = ttlToSeconds(env.refreshTokenTtl);
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' seconds')::interval)`,
    [user.id, hashToken(refreshToken), refreshTtl]
  );
  return {
    accessToken,
    refreshToken,
    expiresIn: ttlToSeconds(env.accessTokenTtl),
    tokenType: "Bearer",
  };
}

/** Rotates a refresh token: the old row is revoked, a fresh pair issued. */
export async function rotateRefreshToken(refreshToken: string): Promise<TokenPair> {
  const row = await queryOne<{ id: number; user_id: number }>(
    `SELECT id, user_id FROM refresh_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [hashToken(refreshToken)]
  );
  if (!row) throw unauthorized("Invalid or expired refresh token");

  await query("UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1", [row.id]);

  const user = await queryOne<{
    id: number;
    username: string;
    email: string;
    organization_id: number | null;
    is_guest: boolean;
  }>(
    "SELECT id, username, email, organization_id, is_guest FROM users WHERE id = $1",
    [row.user_id]
  );
  if (!user) throw unauthorized("User no longer exists");
  return issueTokens(user);
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  await query("UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1", [
    hashToken(refreshToken),
  ]);
}

export async function revokeAllForUser(userId: number): Promise<void> {
  await query(
    "UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
    [userId]
  );
}
