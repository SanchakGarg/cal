import { randomBytes } from "node:crypto";
import { Router } from "express";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../../env.ts";
import { query, queryOne } from "../../db/pool.ts";
import { badRequest, forbidden } from "../../http/errors.ts";
import { handler, ok } from "../../http/respond.ts";
import { asObject, optStr, optTimeZone } from "../../http/validate.ts";
import { issueTokens, revokeRefreshToken, rotateRefreshToken } from "../../auth/jwt.ts";
import {
  assertOidcEnabled,
  authorizeUrl,
  createPkce,
  endSessionUrl,
  exchangeCode,
} from "../../auth/oidc.ts";
import {
  GOOGLE_FLOW_COOKIE,
  consumeNonce,
  openState,
  safeReturnTo,
  sealState,
} from "../../auth/google-flow.ts";
import {
  LOGIN_SCOPES,
  assertGoogleLoginEnabled,
  authorizeUrl as googleAuthorizeUrl,
  exchangeCode as googleExchangeCode,
  assertGoogleCalendarEnabled,
  googleCalendarReady,
  googleLoginReady,
  profileFrom,
} from "../../lib/google.ts";
import { upsertConnection } from "../calendars/repo.ts";
import {
  bootstrapNewUser,
  createUser,
  findUserByEmail,
  findUserByGoogleSubject,
  findUserBySubject,
  type UserRow,
} from "../../auth/users.ts";
import { requireAuth, currentUser } from "../../auth/middleware.ts";
import { rateLimit } from "../../http/rate-limit.ts";

// Guest login and refresh both mint sessions, so they are worth throttling even
// in a single-tenant deployment.
const guestLoginLimiter = rateLimit({ limit: 10, windowMs: 60_000, name: "guest login" });
const refreshLimiter = rateLimit({ limit: 30, windowMs: 60_000, name: "token refresh" });

const FLOW_COOKIE = "cal_oidc_flow";
const flowSecret = new TextEncoder().encode(`${env.jwtSecret}:oidc-flow`);

async function sealFlow(state: string, verifier: string, returnTo: string): Promise<string> {
  return new SignJWT({ state, verifier, returnTo })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
    .sign(flowSecret);
}

async function openFlow(token: string): Promise<{ state: string; verifier: string; returnTo: string }> {
  const { payload } = await jwtVerify(token, flowSecret);
  return {
    state: String(payload.state),
    verifier: String(payload.verifier),
    returnTo: String(payload.returnTo ?? env.webOrigin),
  };
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

const SELECT_TOKEN_USER =
  "SELECT id, username, email, organization_id, is_guest FROM users WHERE id = $1";

async function tokensFor(userId: number) {
  const user = await queryOne<{
    id: number;
    username: string;
    email: string;
    organization_id: number | null;
    is_guest: boolean;
  }>(SELECT_TOKEN_USER, [userId]);
  if (!user) throw badRequest("User not found");
  return issueTokens(user);
}

export const authRouter: Router = Router();

/** Lets the login page render only the methods that are switched on. */
authRouter.get(
  "/providers",
  handler(async (_req, res) => {
    ok(res, {
      oidc: {
        enabled: env.oidc.enabled && Boolean(env.oidc.issuer && env.oidc.clientId),
        label: "Zitadel",
        authorizeUrl: `${env.apiOrigin}/v2/auth/oidc/authorize`,
      },
      google: {
        enabled: googleLoginReady(),
        label: "Google",
        authorizeUrl: `${env.apiOrigin}/v2/auth/google/authorize`,
      },
      guest: { enabled: env.guest.enabled },
      // Calendar linking is configured separately from Google sign-in, so the
      // settings page can offer it even when the login button is hidden.
      googleCalendar: { enabled: googleCalendarReady() },
    });
  })
);

authRouter.get(
  "/oidc/authorize",
  handler(async (req, res) => {
    assertOidcEnabled();
    const state = randomBytes(16).toString("base64url");
    const { verifier, challenge } = createPkce();
    const returnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : env.webOrigin;
    const flow = await sealFlow(state, verifier, returnTo);

    res.cookie(FLOW_COOKIE, flow, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 600_000,
      path: "/",
    });
    res.redirect(await authorizeUrl(state, challenge));
  })
);

authRouter.get(
  "/oidc/callback",
  handler(async (req, res) => {
    assertOidcEnabled();
    const cookie = readCookie(req.header("cookie"), FLOW_COOKIE);
    if (!cookie) throw badRequest("Login flow expired, please start again");
    const flow = await openFlow(cookie);
    if (req.query.error) {
      throw badRequest(`Provider returned an error: ${String(req.query.error)}`);
    }
    if (typeof req.query.code !== "string" || req.query.state !== flow.state) {
      throw badRequest("Invalid OIDC callback parameters");
    }

    const profile = await exchangeCode(req.query.code, flow.verifier);

    let user: UserRow | null = await findUserBySubject(profile.subject);
    let isNew = false;
    if (!user) {
      user = await findUserByEmail(profile.email);
      if (user) {
        await query("UPDATE users SET oidc_subject = $1, updated_at = now() WHERE id = $2", [
          profile.subject,
          user.id,
        ]);
      } else {
        const timeZone = profile.zoneinfo ?? "Europe/London";
        user = await createUser({
          email: profile.email,
          name: profile.name,
          oidcSubject: profile.subject,
          avatarUrl: profile.picture ?? null,
          timeZone,
        });
        await bootstrapNewUser(user, timeZone);
        isNew = true;
      }
    }

    const tokens = await tokensFor(user.id);
    res.clearCookie(FLOW_COOKIE, { path: "/" });

    const redirect = new URL("/auth/callback", flow.returnTo || env.webOrigin);
    redirect.hash = new URLSearchParams({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: String(tokens.expiresIn),
      new_user: String(isNew || !user.completed_onboarding),
    }).toString();
    res.redirect(redirect.toString());
  })
);

// --- Google -------------------------------------------------------------
// Sign-in and calendar linking share this callback; `state` says which flow it
// is. Sign-in is a top-level navigation, so it can also pin the state to a
// cookie; the calendar flow is started from the app and uses a single-use nonce.

authRouter.get(
  "/google/authorize",
  handler(async (req, res) => {
    assertGoogleLoginEnabled();
    const returnTo = safeReturnTo(req.query.returnTo);
    const { token, nonce } = await sealState({ mode: "login", returnTo });
    res.cookie(GOOGLE_FLOW_COOKIE, nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.apiOrigin.startsWith("https://"),
      maxAge: 600_000,
      path: "/",
    });
    res.redirect(googleAuthorizeUrl({ state: token, scopes: LOGIN_SCOPES }));
  })
);

authRouter.get(
  "/google/callback",
  handler(async (req, res) => {
    if (req.query.error) {
      throw badRequest(`Google returned an error: ${String(req.query.error)}`);
    }
    if (typeof req.query.code !== "string" || typeof req.query.state !== "string") {
      throw badRequest("Invalid Google callback parameters");
    }
    const flow = await openState(req.query.state);
    consumeNonce(flow.nonce);

    if (flow.mode === "calendar") {
      // Re-checked here: the feature may have been switched off mid-flow.
      assertGoogleCalendarEnabled();
      await completeCalendarConnect(flow.userId, req.query.code);
      res.clearCookie(GOOGLE_FLOW_COOKIE, { path: "/" });
      const back = new URL(flow.returnTo);
      back.searchParams.set("calendar", "connected");
      res.redirect(back.toString());
      return;
    }

    assertGoogleLoginEnabled();
    // The cookie is what proves this browser started the sign-in.
    const cookieNonce = readCookie(req.header("cookie"), GOOGLE_FLOW_COOKIE);
    if (cookieNonce !== flow.nonce) {
      throw badRequest("Google sign-in flow expired, please start again");
    }

    const tokenSet = await googleExchangeCode(req.query.code);
    const profile = await profileFrom(tokenSet);
    // An unverified address could belong to someone else, and matching on it
    // below would hand over their account.
    if (!profile.emailVerified) {
      throw badRequest("Your Google account's email address is not verified");
    }

    let user: UserRow | null = await findUserByGoogleSubject(profile.subject);
    let isNew = false;
    if (!user) {
      user = await findUserByEmail(profile.email);
      if (user) {
        if (user.is_guest) {
          throw forbidden("That email is already in use by a guest account");
        }
        await query("UPDATE users SET google_subject = $1, updated_at = now() WHERE id = $2", [
          profile.subject,
          user.id,
        ]);
      } else {
        const timeZone = "Europe/London";
        user = await createUser({
          email: profile.email,
          name: profile.name,
          googleSubject: profile.subject,
          avatarUrl: profile.picture ?? null,
          timeZone,
        });
        await bootstrapNewUser(user, timeZone);
        isNew = true;
      }
    }

    const tokens = await tokensFor(user.id);
    res.clearCookie(GOOGLE_FLOW_COOKIE, { path: "/" });

    const redirect = new URL("/auth/callback", flow.returnTo || env.webOrigin);
    redirect.hash = new URLSearchParams({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: String(tokens.expiresIn),
      new_user: String(isNew || !user.completed_onboarding),
    }).toString();
    res.redirect(redirect.toString());
  })
);

/** Stores the calendar grant the user just approved. */
async function completeCalendarConnect(userId: number | undefined, code: string): Promise<void> {
  if (!userId) throw badRequest("This calendar link is missing its account");
  const tokenSet = await googleExchangeCode(code);
  const profile = await profileFrom(tokenSet);
  if (!tokenSet.refreshToken) {
    // Without one we could only write events for the next hour.
    throw badRequest(
      "Google did not return a refresh token. Remove this app from your Google account's " +
        "third-party access list and connect again."
    );
  }
  await upsertConnection({
    userId,
    email: profile.email,
    subject: profile.subject || null,
    accessToken: tokenSet.accessToken,
    refreshToken: tokenSet.refreshToken,
    expiresAt: tokenSet.expiresAt,
    scopes: tokenSet.scopes,
  });
}

/** Guest login: no provider, straight to a throwaway account for local testing.
 *
 *  Guest login proves nothing about the caller, so it must never hand back a
 *  session for an account that belongs to someone: a supplied email may only
 *  ever resume a guest account, never a real (OIDC) one. */
authRouter.post(
  "/guest",
  guestLoginLimiter,
  handler(async (req, res) => {
    if (!env.guest.enabled) throw forbidden("Guest login is disabled");
    const body = asObject(req.body);
    const name = optStr(body, "name", { max: 80 });
    const email = optStr(body, "email", { max: 200 });
    const timeZone = optTimeZone(body, "timeZone") ?? "Europe/London";

    const existing: UserRow | null = email ? await findUserByEmail(email) : null;
    if (existing && !existing.is_guest) {
      throw forbidden("That email belongs to a registered account — sign in with your provider");
    }

    let user: UserRow | null = existing;
    let isNew = false;
    if (!user) {
      if (!env.guest.autoCreate) throw forbidden("Guest account creation is disabled");
      const suffix = randomBytes(3).toString("hex");
      user = await createUser({
        email: email ?? `guest-${suffix}@guest.local`,
        name: name ?? `Guest ${suffix}`,
        username: name ?? `guest-${suffix}`,
        isGuest: true,
        timeZone,
      });
      await bootstrapNewUser(user, timeZone);
      isNew = true;
    }

    const tokens = await tokensFor(user.id);
    ok(res, {
      ...tokens,
      isNewUser: isNew || !user.completed_onboarding,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        isGuest: user.is_guest,
      },
    });
  })
);

authRouter.post(
  "/refresh",
  refreshLimiter,
  handler(async (req, res) => {
    const body = asObject(req.body);
    const refreshToken = optStr(body, "refreshToken");
    if (!refreshToken) throw badRequest("refreshToken is required");
    ok(res, await rotateRefreshToken(refreshToken));
  })
);

authRouter.post(
  "/logout",
  requireAuth,
  handler(async (req, res) => {
    const body = asObject(req.body ?? {});
    const refreshToken = optStr(body, "refreshToken");
    if (refreshToken) await revokeRefreshToken(refreshToken);
    currentUser(req);
    ok(res, { loggedOut: true, providerLogoutUrl: await endSessionUrl() });
  })
);
