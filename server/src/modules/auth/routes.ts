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
  bootstrapNewUser,
  createUser,
  findUserByEmail,
  findUserBySubject,
  type UserRow,
} from "../../auth/users.ts";
import { requireAuth, currentUser } from "../../auth/middleware.ts";

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
      guest: { enabled: env.guest.enabled },
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

/** Guest login: no provider, straight to a throwaway account for local testing. */
authRouter.post(
  "/guest",
  handler(async (req, res) => {
    if (!env.guest.enabled) throw forbidden("Guest login is disabled");
    const body = asObject(req.body);
    const name = optStr(body, "name", { max: 80 });
    const email = optStr(body, "email", { max: 200 });
    const timeZone = optTimeZone(body, "timeZone") ?? "Europe/London";

    let user: UserRow | null = email ? await findUserByEmail(email) : null;
    let isNew = false;
    if (!user) {
      if (!env.guest.autoCreate && email) throw forbidden("Guest account creation is disabled");
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
