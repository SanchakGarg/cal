import type { NextFunction, Request, RequestHandler, Response } from "express";
import { queryOne } from "../db/pool.ts";
import { forbidden, unauthorized } from "../http/errors.ts";
import { verifyAccessToken } from "./jwt.ts";

export interface AuthUser {
  id: number;
  uid: string;
  username: string;
  email: string;
  name: string;
  time_zone: string;
  week_start: string;
  time_format: number;
  locale: string;
  default_schedule_id: number | null;
  organization_id: number | null;
  is_guest: boolean;
  completed_onboarding: boolean;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

const SELECT_USER = `
  SELECT id, uid, username, email, name, time_zone, week_start, time_format, locale,
         default_schedule_id, organization_id, is_guest, completed_onboarding
  FROM users WHERE id = $1`;

function bearer(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (!token || scheme.toLowerCase() !== "bearer") return null;
  return token;
}

async function loadUser(token: string): Promise<AuthUser> {
  const claims = await verifyAccessToken(token);
  const user = await queryOne<AuthUser>(SELECT_USER, [Number(claims.sub)]);
  if (!user) throw unauthorized("User no longer exists");
  return user;
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = bearer(req);
  if (!token) {
    next(unauthorized("Missing bearer token"));
    return;
  }
  loadUser(token)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(next);
};

export const optionalAuth: RequestHandler = (req, _res, next) => {
  const token = bearer(req);
  if (!token) {
    next();
    return;
  }
  loadUser(token)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(() => next());
};

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized("Authentication required");
  return req.user;
}

export type TeamRole = "OWNER" | "ADMIN" | "MEMBER";

export async function membershipRole(userId: number, teamId: number): Promise<TeamRole | null> {
  const row = await queryOne<{ role: TeamRole }>(
    "SELECT role FROM memberships WHERE user_id = $1 AND team_id = $2 AND accepted = TRUE",
    [userId, teamId]
  );
  return row?.role ?? null;
}

/** Team access also passes for admins/owners of the team's parent organization. */
export async function assertTeamRole(
  userId: number,
  teamId: number,
  allowed: TeamRole[]
): Promise<TeamRole> {
  const direct = await membershipRole(userId, teamId);
  if (direct && allowed.includes(direct)) return direct;

  const parent = await queryOne<{ parent_id: number | null }>(
    "SELECT parent_id FROM teams WHERE id = $1",
    [teamId]
  );
  if (parent?.parent_id) {
    const orgRole = await membershipRole(userId, parent.parent_id);
    if (orgRole === "OWNER" || orgRole === "ADMIN") return orgRole;
  }
  if (direct) throw forbidden(`Requires team role: ${allowed.join(" or ")}`);
  throw forbidden("You are not a member of this team");
}

export async function assertOrgRole(
  userId: number,
  orgId: number,
  allowed: TeamRole[]
): Promise<TeamRole> {
  const role = await membershipRole(userId, orgId);
  if (!role) throw forbidden("You are not a member of this organization");
  if (!allowed.includes(role)) throw forbidden(`Requires organization role: ${allowed.join(" or ")}`);
  return role;
}

/** Blocks a route entirely, used when a feature flag is off. */
export function disabled(message: string): RequestHandler {
  return (_req: Request, _res: Response, next: NextFunction) => {
    next(forbidden(message));
  };
}
