// State handling shared by the two Google OAuth flows.
//
// Both flows come back to the same registered redirect URI, so `state` carries a
// signed description of which one started and where to hand the browser back.
// The sign-in flow additionally pins the state to a cookie set on the outbound
// navigation; the calendar flow cannot (it is started from a fetch on another
// origin) and relies on a single-use nonce instead.

import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../env.ts";
import { badRequest } from "../http/errors.ts";

const secret = new TextEncoder().encode(`${env.jwtSecret}:google-flow`);
const TTL_SECONDS = 600;

export const GOOGLE_FLOW_COOKIE = "cal_google_flow";

export interface GoogleFlowState {
  mode: "login" | "calendar";
  nonce: string;
  returnTo: string;
  /** Present on the calendar flow: whose account the grant attaches to. */
  userId?: number;
}

export async function sealState(state: Omit<GoogleFlowState, "nonce">): Promise<{
  token: string;
  nonce: string;
}> {
  const nonce = randomBytes(16).toString("base64url");
  const token = await new SignJWT({ ...state, nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + TTL_SECONDS)
    .sign(secret);
  return { token, nonce };
}

export async function openState(token: string): Promise<GoogleFlowState> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = (await jwtVerify(token, secret)) as { payload: Record<string, unknown> });
  } catch {
    throw badRequest("The Google sign-in flow expired, please start again");
  }
  const mode = payload.mode === "calendar" ? "calendar" : "login";
  return {
    mode,
    nonce: String(payload.nonce ?? ""),
    returnTo: String(payload.returnTo ?? env.webOrigin),
    userId: typeof payload.userId === "number" ? payload.userId : undefined,
  };
}

// Nonces already redeemed, so a state that leaks cannot be replayed. Entries
// are dropped once they are older than the state itself can be.
const usedNonces = new Map<string, number>();

export function consumeNonce(nonce: string): void {
  const now = Date.now();
  for (const [key, at] of usedNonces) {
    if (now - at > TTL_SECONDS * 1000) usedNonces.delete(key);
  }
  if (usedNonces.has(nonce)) throw badRequest("This Google sign-in link has already been used");
  usedNonces.set(nonce, now);
}

/** Keeps a hand-back URL on the deployment's own web origin. */
export function safeReturnTo(raw: unknown): string {
  if (typeof raw !== "string" || raw === "") return env.webOrigin;
  try {
    const candidate = new URL(raw, env.webOrigin);
    const allowed = new URL(env.webOrigin);
    if (env.webOrigin !== "*" && candidate.origin !== allowed.origin) return env.webOrigin;
    return candidate.toString();
  } catch {
    return env.webOrigin;
  }
}
