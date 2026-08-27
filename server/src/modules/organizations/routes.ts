import { Router } from "express";
import { query, queryOne } from "../../db/pool.ts";
import { badRequest, forbidden, notFound } from "../../http/errors.ts";
import { handler, ok } from "../../http/respond.ts";
import {
  asObject,
  array,
  oneOf,
  optBool,
  optInt,
  optStr,
  optTimeZone,
  paramInt,
  str,
} from "../../http/validate.ts";
import { assertOrgRole, currentUser, requireAuth } from "../../auth/middleware.ts";
import { createUser } from "../../auth/users.ts";
import { type BookingRow, serializeMe, type UserRecord } from "../serialize.ts";
import { presentBooking } from "../bookings/service.ts";
import { listTeamEventTypes } from "../event-types/repo.ts";
import {
  addMembership,
  createTeam,
  getMembership,
  getTeam,
  inviteToTeam,
  listChildTeams,
  listMemberships,
  listTeamsForUser,
  removeMembership,
  updateMembership,
  updateTeam,
} from "../teams/repo.ts";
import { assertMayAssignRole, assertMayChangeMembership, parseTeamInput } from "../teams/routes.ts";
import {
  createSchedule,
  deleteSchedule,
  getScheduleDetail,
  listSchedules,
  updateSchedule,
} from "../schedules/repo.ts";
import { parseAvailability, parseOverrides } from "../schedules/routes.ts";
import { DEFAULT_TIME_ZONE } from "../../lib/tz.ts";

const ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
const OOO_REASONS = ["unspecified", "vacation", "travel", "sick", "public_holiday"] as const;

async function assertOrgExists(orgId: number): Promise<void> {
  const org = await queryOne("SELECT 1 FROM teams WHERE id = $1 AND is_organization = TRUE", [orgId]);
  if (!org) throw notFound("Organization not found");
}

async function assertOrgMember(orgId: number, userId: number): Promise<void> {
  const member = await queryOne(
    "SELECT 1 FROM memberships WHERE team_id = $1 AND user_id = $2 AND accepted = TRUE",
    [orgId, userId]
  );
  if (!member) throw notFound("That user is not a member of this organization");
}

async function assertTeamInOrg(orgId: number, teamId: number): Promise<void> {
  const team = await queryOne("SELECT 1 FROM teams WHERE id = $1 AND parent_id = $2", [teamId, orgId]);
  if (!team) throw notFound("Team not found in this organization");
}

export const organizationsRouter: Router = Router();

organizationsRouter.use(requireAuth);

organizationsRouter.get(
  "/",
  handler(async (req, res) => {
    ok(res, await listTeamsForUser(currentUser(req).id, { organizations: true }));
  })
);

organizationsRouter.post(
  "/",
  handler(async (req, res) => {
    const user = currentUser(req);
    const input = parseTeamInput(req.body);
    ok(
      res,
      await createTeam(
        { ...input, parentId: null, isOrganization: true },
        { userId: user.id, autoAcceptCreator: true }
      ),
      201
    );
  })
);

organizationsRouter.get(
  "/:orgId",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN", "MEMBER"]);
    ok(res, await getTeam(orgId));
  })
);

organizationsRouter.patch(
  "/:orgId",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN"]);
    ok(res, await updateTeam(orgId, parseTeamInput(req.body, { partial: true })));
  })
);

/* ---------- members ---------- */

organizationsRouter.get(
  "/:orgId/users",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN", "MEMBER"]);
    const rows = await query<UserRecord & { role: string; accepted: boolean }>(
      `SELECT u.id, u.username, u.email, u.name, u.avatar_url, u.bio, u.time_zone, u.week_start,
              u.time_format, u.locale, u.default_schedule_id, u.organization_id,
              m.role, m.accepted
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.team_id = $1 ORDER BY u.id`,
      [orgId]
    );
    ok(
      res,
      rows.map((row) => ({ ...serializeMe(row), role: row.role, accepted: row.accepted }))
    );
  })
);

organizationsRouter.post(
  "/:orgId/users",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    const actorRole = await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN"]);
    const body = asObject(req.body);
    const email = str(body, "email", { max: 200 });
    const newRole = oneOf(body, "role", ROLES);
    assertMayAssignRole(actorRole, newRole);

    let user = await queryOne<{ id: number }>("SELECT id FROM users WHERE lower(email) = lower($1)", [
      email,
    ]);
    if (!user) {
      const created = await createUser({
        email,
        name: optStr(body, "name", { max: 120 }),
        username: optStr(body, "username", { max: 64 }),
        timeZone: optTimeZone(body, "timeZone"),
      });
      user = { id: created.id };
    }
    const membership = await addMembership(orgId, {
      userId: user.id,
      role: newRole,
      accepted: optBool(body, "accepted") ?? true,
    });
    ok(res, membership, 201);
  })
);

organizationsRouter.patch(
  "/:orgId/users/:userId",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    const actorRole = await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN"]);
    const userId = paramInt(req.params.userId, "userId");
    await assertOrgMember(orgId, userId);
    const body = asObject(req.body);
    const timeFormat = optInt(body, "timeFormat");
    if (timeFormat !== undefined && timeFormat !== 12 && timeFormat !== 24) {
      throw badRequest("timeFormat must be 12 or 24");
    }
    await query(
      `UPDATE users SET
         name = COALESCE($2, name),
         email = COALESCE($3, email),
         time_zone = COALESCE($4, time_zone),
         week_start = COALESCE($5, week_start),
         time_format = COALESCE($6, time_format),
         locale = COALESCE($7, locale),
         updated_at = now()
       WHERE id = $1`,
      [
        userId,
        optStr(body, "name", { max: 120 }) ?? null,
        optStr(body, "email", { max: 200 }) ?? null,
        optTimeZone(body, "timeZone") ?? null,
        oneOf(body, "weekStart", ["Sunday", "Monday", "Saturday"] as const) ?? null,
        timeFormat ?? null,
        optStr(body, "locale", { max: 10 }) ?? null,
      ]
    );
    const role = oneOf(body, "role", ROLES);
    if (role) {
      assertMayAssignRole(actorRole, role);
      const membership = await queryOne<{ id: number }>(
        "SELECT id FROM memberships WHERE team_id = $1 AND user_id = $2",
        [orgId, userId]
      );
      if (membership) {
        await assertMayChangeMembership(actorRole, orgId, membership.id);
        await updateMembership(orgId, membership.id, { role });
      }
    }
    const updated = await queryOne<UserRecord>(
      `SELECT id, username, email, name, avatar_url, bio, time_zone, week_start, time_format,
              locale, default_schedule_id, organization_id
       FROM users WHERE id = $1`,
      [userId]
    );
    ok(res, serializeMe(updated!));
  })
);

organizationsRouter.delete(
  "/:orgId/users/:userId",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    const actorRole = await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN"]);
    const userId = paramInt(req.params.userId, "userId");
    const membership = await queryOne<{ id: number }>(
      "SELECT id FROM memberships WHERE team_id = $1 AND user_id = $2",
      [orgId, userId]
    );
    if (!membership) throw notFound("That user is not a member of this organization");
    await assertMayChangeMembership(actorRole, orgId, membership.id);
    await removeMembership(orgId, membership.id);
    await query("UPDATE users SET organization_id = NULL WHERE id = $1 AND organization_id = $2", [
      userId,
      orgId,
    ]);
    ok(res, { id: userId });
  })
);

organizationsRouter.get(
  "/:orgId/memberships",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN", "MEMBER"]);
    ok(res, await listMemberships(orgId));
  })
);

organizationsRouter.post(
  "/:orgId/memberships",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    const actorRole = await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN"]);
    const body = asObject(req.body);
    const role = oneOf(body, "role", ROLES);
    assertMayAssignRole(actorRole, role);
    const userId = optInt(body, "userId");
    if (userId === undefined) throw badRequest("userId is required");
    ok(
      res,
      await addMembership(orgId, {
        userId,
        role,
        accepted: optBool(body, "accepted") ?? true,
      }),
      201
    );
  })
);

organizationsRouter.get(
  "/:orgId/memberships/:membershipId",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN", "MEMBER"]);
    ok(res, await getMembership(orgId, paramInt(req.params.membershipId, "membershipId")));
  })
);

organizationsRouter.patch(
  "/:orgId/memberships/:membershipId",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    const actorRole = await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN"]);
    const membershipId = paramInt(req.params.membershipId, "membershipId");
    const body = asObject(req.body);
    const role = oneOf(body, "role", ROLES);
    assertMayAssignRole(actorRole, role);
    if (role) await assertMayChangeMembership(actorRole, orgId, membershipId);
    ok(
      res,
      await updateMembership(orgId, membershipId, {
        role,
        accepted: optBool(body, "accepted"),
      })
    );
  })
);

organizationsRouter.delete(
  "/:orgId/memberships/:membershipId",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    const actorRole = await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN"]);
    const membershipId = paramInt(req.params.membershipId, "membershipId");
    await assertMayChangeMembership(actorRole, orgId, membershipId);
    await removeMembership(orgId, membershipId);
    ok(res, { id: membershipId });
  })
);

/* ---------- teams inside the organization ---------- */

organizationsRouter.get(
  "/:orgId/teams",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN", "MEMBER"]);
    ok(res, await listChildTeams(orgId));
  })
);

organizationsRouter.get(
  "/:orgId/teams/me",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    const user = currentUser(req);
    await assertOrgRole(user.id, orgId, ["OWNER", "ADMIN", "MEMBER"]);
    const rows = await query(
      `SELECT t.id, t.name, t.slug, m.role, m.accepted
       FROM teams t JOIN memberships m ON m.team_id = t.id
       WHERE t.parent_id = $1 AND m.user_id = $2
       ORDER BY t.id`,
      [orgId, user.id]
    );
    ok(res, rows);
  })
);

organizationsRouter.post(
  "/:orgId/teams",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    const user = currentUser(req);
    await assertOrgRole(user.id, orgId, ["OWNER", "ADMIN"]);
    const input = parseTeamInput(req.body);
    ok(
      res,
      await createTeam(
        { ...input, parentId: orgId, isOrganization: false },
        {
          userId: user.id,
          autoAcceptCreator: input.autoAcceptCreator ?? true,
          addCreatorAsOwner: input.addCreatorAsOwner,
        }
      ),
      201
    );
  })
);

organizationsRouter.get(
  "/:orgId/teams/event-types",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN", "MEMBER"]);
    const teams = await listChildTeams(orgId);
    const eventTypes = await Promise.all(teams.map((team) => listTeamEventTypes(team.id)));
    ok(res, eventTypes.flat());
  })
);

organizationsRouter.post(
  "/:orgId/teams/:teamId/invite",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    const teamId = paramInt(req.params.teamId, "teamId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN"]);
    await assertTeamInOrg(orgId, teamId);
    const body = asObject(req.body);
    const raw = body.email !== undefined ? [body] : array(body, "invites", { required: true });
    const invites = raw.map((entry, index) => {
      const item = asObject(entry, `invites[${index}]`);
      return { email: str(item, "email", { max: 200 }), role: oneOf(item, "role", ROLES) };
    });
    ok(res, await inviteToTeam(teamId, invites), 201);
  })
);

organizationsRouter.get(
  "/:orgId/teams/:teamId/memberships",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    const teamId = paramInt(req.params.teamId, "teamId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN", "MEMBER"]);
    await assertTeamInOrg(orgId, teamId);
    ok(res, await listMemberships(teamId));
  })
);

organizationsRouter.post(
  "/:orgId/teams/:teamId/memberships",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    const teamId = paramInt(req.params.teamId, "teamId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN"]);
    await assertTeamInOrg(orgId, teamId);
    const body = asObject(req.body);
    const userId = optInt(body, "userId") ?? 0;
    await assertOrgMember(orgId, userId);
    ok(
      res,
      await addMembership(teamId, {
        userId,
        role: oneOf(body, "role", ROLES),
        accepted: optBool(body, "accepted") ?? true,
      }),
      201
    );
  })
);

organizationsRouter.delete(
  "/:orgId/teams/:teamId/memberships/:membershipId",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    const teamId = paramInt(req.params.teamId, "teamId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN"]);
    await assertTeamInOrg(orgId, teamId);
    const membershipId = paramInt(req.params.membershipId, "membershipId");
    await removeMembership(teamId, membershipId);
    ok(res, { id: membershipId });
  })
);

/* ---------- availability of organization members ---------- */

organizationsRouter.get(
  "/:orgId/schedules",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN"]);
    const rows = await query(
      `SELECT s.id, s.user_id AS "ownerId", u.username AS "ownerUsername", s.name, s.time_zone AS "timeZone"
       FROM schedules s
       JOIN users u ON u.id = s.user_id
       JOIN memberships m ON m.user_id = u.id AND m.team_id = $1 AND m.accepted = TRUE
       ORDER BY u.id, s.id`,
      [orgId]
    );
    ok(res, rows);
  })
);

organizationsRouter.get(
  "/:orgId/users/:userId/schedules",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN"]);
    const userId = paramInt(req.params.userId, "userId");
    await assertOrgMember(orgId, userId);
    ok(res, await listSchedules(userId));
  })
);

organizationsRouter.post(
  "/:orgId/users/:userId/schedules",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN"]);
    const userId = paramInt(req.params.userId, "userId");
    await assertOrgMember(orgId, userId);
    const body = asObject(req.body);
    const availability = body.availability === undefined ? undefined : array(body, "availability");
    const overrides = body.overrides === undefined ? undefined : array(body, "overrides");
    const scheduleId = await createSchedule(userId, {
      name: str(body, "name", { max: 120 }),
      timeZone: optTimeZone(body, "timeZone") ?? DEFAULT_TIME_ZONE,
      isDefault: optBool(body, "isDefault") ?? false,
      availability: availability ? parseAvailability(availability) : undefined,
      overrides: overrides ? parseOverrides(overrides) : undefined,
    });
    ok(res, await getScheduleDetail(scheduleId, userId), 201);
  })
);

organizationsRouter.get(
  "/:orgId/users/:userId/schedules/:scheduleId",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN"]);
    const userId = paramInt(req.params.userId, "userId");
    await assertOrgMember(orgId, userId);
    ok(res, await getScheduleDetail(paramInt(req.params.scheduleId, "scheduleId"), userId));
  })
);

organizationsRouter.patch(
  "/:orgId/users/:userId/schedules/:scheduleId",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN"]);
    const userId = paramInt(req.params.userId, "userId");
    await assertOrgMember(orgId, userId);
    const scheduleId = paramInt(req.params.scheduleId, "scheduleId");
    const body = asObject(req.body);
    const availability = body.availability === undefined ? undefined : array(body, "availability");
    const overrides = body.overrides === undefined ? undefined : array(body, "overrides");
    await updateSchedule(scheduleId, userId, {
      name: optStr(body, "name", { max: 120 }),
      timeZone: optTimeZone(body, "timeZone"),
      isDefault: optBool(body, "isDefault"),
      availability: availability ? parseAvailability(availability) : undefined,
      overrides: overrides ? parseOverrides(overrides) : undefined,
    });
    ok(res, await getScheduleDetail(scheduleId, userId));
  })
);

organizationsRouter.delete(
  "/:orgId/users/:userId/schedules/:scheduleId",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN"]);
    const userId = paramInt(req.params.userId, "userId");
    await assertOrgMember(orgId, userId);
    const scheduleId = paramInt(req.params.scheduleId, "scheduleId");
    await deleteSchedule(scheduleId, userId);
    ok(res, { id: scheduleId });
  })
);

organizationsRouter.get(
  "/:orgId/ooo",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN"]);
    const rows = await query(
      `SELECT o.id, o.uuid, o.user_id, o.start_date, o.end_date, o.reason, o.notes, o.to_user_id,
              u.username
       FROM out_of_office o
       JOIN memberships m ON m.user_id = o.user_id AND m.team_id = $1 AND m.accepted = TRUE
       JOIN users u ON u.id = o.user_id
       ORDER BY o.start_date DESC`,
      [orgId]
    );
    ok(res, rows);
  })
);

organizationsRouter.post(
  "/:orgId/users/:userId/ooo",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN"]);
    const userId = paramInt(req.params.userId, "userId");
    await assertOrgMember(orgId, userId);
    const body = asObject(req.body);
    const row = await queryOne(
      `INSERT INTO out_of_office (uuid, user_id, start_date, end_date, reason, notes, to_user_id)
       VALUES (gen_random_uuid()::text, $1, $2, $3, COALESCE($4, 'unspecified'), $5, $6)
       RETURNING id, uuid, user_id, start_date, end_date, reason, notes, to_user_id`,
      [
        userId,
        str(body, "start"),
        str(body, "end"),
        oneOf(body, "reason", OOO_REASONS) ?? null,
        optStr(body, "notes", { max: 1000 }) ?? null,
        optInt(body, "toUserId") ?? null,
      ]
    );
    ok(res, row, 201);
  })
);

organizationsRouter.delete(
  "/:orgId/users/:userId/ooo/:oooId",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN"]);
    const userId = paramInt(req.params.userId, "userId");
    const oooId = paramInt(req.params.oooId, "oooId");
    const row = await queryOne<{ id: number }>(
      "DELETE FROM out_of_office WHERE id = $1 AND user_id = $2 RETURNING id",
      [oooId, userId]
    );
    if (!row) throw notFound("Out of office entry not found");
    ok(res, { id: row.id });
  })
);

organizationsRouter.get(
  "/:orgId/bookings",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN"]);
    await assertOrgExists(orgId);
    const rows = await query<BookingRow>(
      `SELECT DISTINCT b.* FROM bookings b
       LEFT JOIN event_types e ON e.id = b.event_type_id
       LEFT JOIN teams t ON t.id = e.team_id
       LEFT JOIN memberships m ON m.user_id = b.user_id AND m.team_id = $1 AND m.accepted = TRUE
       WHERE t.parent_id = $1 OR t.id = $1 OR m.id IS NOT NULL
       ORDER BY b.start_time DESC
       LIMIT 200`,
      [orgId]
    );
    ok(res, await Promise.all(rows.map(presentBooking)));
  })
);

organizationsRouter.get(
  "/:orgId/users/:userId/bookings",
  handler(async (req, res) => {
    const orgId = paramInt(req.params.orgId, "orgId");
    await assertOrgRole(currentUser(req).id, orgId, ["OWNER", "ADMIN"]);
    const userId = paramInt(req.params.userId, "userId");
    await assertOrgMember(orgId, userId);
    const rows = await query<BookingRow>(
      `SELECT b.* FROM bookings b
       WHERE b.user_id = $1 OR EXISTS (
         SELECT 1 FROM booking_hosts h WHERE h.booking_id = b.id AND h.user_id = $1)
       ORDER BY b.start_time DESC LIMIT 200`,
      [userId]
    );
    ok(res, await Promise.all(rows.map(presentBooking)));
  })
);

void forbidden;
