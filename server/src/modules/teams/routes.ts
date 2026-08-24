import { Router } from "express";
import { query, queryOne } from "../../db/pool.ts";
import { badRequest, notFound } from "../../http/errors.ts";
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
import { assertTeamRole, currentUser, requireAuth } from "../../auth/middleware.ts";
import { parseEventTypeInput } from "../event-types/input.ts";
import {
  createEventType,
  findEventTypeById,
  listTeamEventTypes,
  present,
  updateEventType,
  deleteEventType,
} from "../event-types/repo.ts";
import { type BookingRow, type ScheduleRow } from "../serialize.ts";
import { presentBooking } from "../bookings/service.ts";
import {
  acceptInvite,
  addMembership,
  createTeam,
  deleteTeam,
  getMembership,
  getTeam,
  inviteToTeam,
  listMemberships,
  listTeamsForUser,
  removeMembership,
  updateMembership,
  updateTeam,
} from "./repo.ts";

const ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;

export function parseTeamInput(raw: unknown, opts: { partial?: boolean } = {}) {
  const body = asObject(raw);
  const timeFormat = optInt(body, "timeFormat");
  if (timeFormat !== undefined && timeFormat !== 12 && timeFormat !== 24) {
    throw badRequest("timeFormat must be 12 or 24");
  }
  return {
    name: opts.partial ? (optStr(body, "name", { max: 120 }) as string) : str(body, "name", { max: 120 }),
    slug: optStr(body, "slug", { max: 64 }),
    bio: optStr(body, "bio", { max: 2000 }),
    logoUrl: optStr(body, "logoUrl", { max: 500 }),
    bannerUrl: optStr(body, "bannerUrl", { max: 500 }),
    isPrivate: optBool(body, "isPrivate"),
    hideBranding: optBool(body, "hideBranding"),
    hideBookATeamMember: optBool(body, "hideBookATeamMember"),
    theme: optStr(body, "theme", { max: 20 }),
    brandColor: optStr(body, "brandColor", { max: 9 }),
    darkBrandColor: optStr(body, "darkBrandColor", { max: 9 }),
    timeZone: optTimeZone(body, "timeZone"),
    weekStart: oneOf(body, "weekStart", ["Sunday", "Monday", "Saturday"] as const),
    timeFormat,
    autoAcceptCreator: optBool(body, "autoAcceptCreator"),
    addCreatorAsOwner: optBool(body, "addCreatorAsOwner"),
  };
}

export const teamsRouter: Router = Router();

teamsRouter.use(requireAuth);

teamsRouter.get(
  "/",
  handler(async (req, res) => {
    ok(res, await listTeamsForUser(currentUser(req).id));
  })
);

teamsRouter.post(
  "/",
  handler(async (req, res) => {
    const user = currentUser(req);
    const input = parseTeamInput(req.body);
    ok(
      res,
      await createTeam(
        { ...input, parentId: null, isOrganization: false },
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

teamsRouter.post(
  "/invites/accept",
  handler(async (req, res) => {
    const body = asObject(req.body);
    ok(res, await acceptInvite(str(body, "token"), currentUser(req).id));
  })
);

teamsRouter.get(
  "/:teamId",
  handler(async (req, res) => {
    const teamId = paramInt(req.params.teamId, "teamId");
    await assertTeamRole(currentUser(req).id, teamId, ["OWNER", "ADMIN", "MEMBER"]);
    ok(res, await getTeam(teamId));
  })
);

teamsRouter.patch(
  "/:teamId",
  handler(async (req, res) => {
    const teamId = paramInt(req.params.teamId, "teamId");
    await assertTeamRole(currentUser(req).id, teamId, ["OWNER", "ADMIN"]);
    ok(res, await updateTeam(teamId, parseTeamInput(req.body, { partial: true })));
  })
);

teamsRouter.delete(
  "/:teamId",
  handler(async (req, res) => {
    const teamId = paramInt(req.params.teamId, "teamId");
    await assertTeamRole(currentUser(req).id, teamId, ["OWNER"]);
    await deleteTeam(teamId);
    ok(res, { id: teamId });
  })
);

teamsRouter.get(
  "/:teamId/memberships",
  handler(async (req, res) => {
    const teamId = paramInt(req.params.teamId, "teamId");
    await assertTeamRole(currentUser(req).id, teamId, ["OWNER", "ADMIN", "MEMBER"]);
    ok(res, await listMemberships(teamId));
  })
);

teamsRouter.get(
  "/:teamId/memberships/:membershipId",
  handler(async (req, res) => {
    const teamId = paramInt(req.params.teamId, "teamId");
    await assertTeamRole(currentUser(req).id, teamId, ["OWNER", "ADMIN", "MEMBER"]);
    ok(res, await getMembership(teamId, paramInt(req.params.membershipId, "membershipId")));
  })
);

teamsRouter.post(
  "/:teamId/memberships",
  handler(async (req, res) => {
    const teamId = paramInt(req.params.teamId, "teamId");
    await assertTeamRole(currentUser(req).id, teamId, ["OWNER", "ADMIN"]);
    const body = asObject(req.body);
    ok(
      res,
      await addMembership(teamId, {
        userId: optInt(body, "userId") ?? 0,
        role: oneOf(body, "role", ROLES),
        accepted: optBool(body, "accepted"),
      }),
      201
    );
  })
);

teamsRouter.patch(
  "/:teamId/memberships/:membershipId",
  handler(async (req, res) => {
    const teamId = paramInt(req.params.teamId, "teamId");
    await assertTeamRole(currentUser(req).id, teamId, ["OWNER", "ADMIN"]);
    const body = asObject(req.body);
    ok(
      res,
      await updateMembership(teamId, paramInt(req.params.membershipId, "membershipId"), {
        role: oneOf(body, "role", ROLES),
        accepted: optBool(body, "accepted"),
        disableImpersonation: optBool(body, "disableImpersonation"),
      })
    );
  })
);

teamsRouter.delete(
  "/:teamId/memberships/:membershipId",
  handler(async (req, res) => {
    const teamId = paramInt(req.params.teamId, "teamId");
    await assertTeamRole(currentUser(req).id, teamId, ["OWNER", "ADMIN"]);
    const membershipId = paramInt(req.params.membershipId, "membershipId");
    await removeMembership(teamId, membershipId);
    ok(res, { id: membershipId });
  })
);

teamsRouter.post(
  "/:teamId/invite",
  handler(async (req, res) => {
    const teamId = paramInt(req.params.teamId, "teamId");
    await assertTeamRole(currentUser(req).id, teamId, ["OWNER", "ADMIN"]);
    const body = asObject(req.body);
    const raw = body.email !== undefined ? [body] : array(body, "invites", { required: true });
    const invites = raw.map((entry, index) => {
      const item = asObject(entry, `invites[${index}]`);
      return {
        email: str(item, "email", { max: 200 }),
        role: oneOf(item, "role", ROLES),
      };
    });
    ok(res, await inviteToTeam(teamId, invites), 201);
  })
);

teamsRouter.get(
  "/:teamId/event-types",
  handler(async (req, res) => {
    const teamId = paramInt(req.params.teamId, "teamId");
    await assertTeamRole(currentUser(req).id, teamId, ["OWNER", "ADMIN", "MEMBER"]);
    ok(res, await listTeamEventTypes(teamId));
  })
);

teamsRouter.post(
  "/:teamId/event-types",
  handler(async (req, res) => {
    const teamId = paramInt(req.params.teamId, "teamId");
    await assertTeamRole(currentUser(req).id, teamId, ["OWNER", "ADMIN"]);
    const { columns, hosts } = parseEventTypeInput(req.body, { team: true });
    const row = await createEventType({
      teamId,
      columns,
      hosts,
      assignAllTeamMembers: columns.assign_all_team_members ?? false,
    });
    ok(res, await present(row), 201);
  })
);

teamsRouter.get(
  "/:teamId/event-types/:eventTypeId",
  handler(async (req, res) => {
    const teamId = paramInt(req.params.teamId, "teamId");
    await assertTeamRole(currentUser(req).id, teamId, ["OWNER", "ADMIN", "MEMBER"]);
    const row = await findEventTypeById(paramInt(req.params.eventTypeId, "eventTypeId"));
    if (row.team_id !== teamId) throw notFound("Event type not found in this team");
    ok(res, await present(row));
  })
);

teamsRouter.patch(
  "/:teamId/event-types/:eventTypeId",
  handler(async (req, res) => {
    const teamId = paramInt(req.params.teamId, "teamId");
    await assertTeamRole(currentUser(req).id, teamId, ["OWNER", "ADMIN"]);
    const row = await findEventTypeById(paramInt(req.params.eventTypeId, "eventTypeId"));
    if (row.team_id !== teamId) throw notFound("Event type not found in this team");
    const { columns, hosts } = parseEventTypeInput(req.body, { partial: true, team: true });
    ok(res, await present(await updateEventType(row.id, columns, hosts)));
  })
);

teamsRouter.delete(
  "/:teamId/event-types/:eventTypeId",
  handler(async (req, res) => {
    const teamId = paramInt(req.params.teamId, "teamId");
    await assertTeamRole(currentUser(req).id, teamId, ["OWNER", "ADMIN"]);
    const row = await findEventTypeById(paramInt(req.params.eventTypeId, "eventTypeId"));
    if (row.team_id !== teamId) throw notFound("Event type not found in this team");
    await deleteEventType(row.id);
    ok(res, { id: row.id });
  })
);

/** Every member's schedules, so an admin can see why a slot is missing. */
teamsRouter.get(
  "/:teamId/schedules",
  handler(async (req, res) => {
    const teamId = paramInt(req.params.teamId, "teamId");
    await assertTeamRole(currentUser(req).id, teamId, ["OWNER", "ADMIN"]);
    const rows = await query<ScheduleRow & { username: string }>(
      `SELECT s.id, s.user_id, s.name, s.time_zone, u.username
       FROM schedules s
       JOIN users u ON u.id = s.user_id
       JOIN memberships m ON m.user_id = u.id AND m.team_id = $1 AND m.accepted = TRUE
       ORDER BY u.id, s.id`,
      [teamId]
    );
    ok(
      res,
      rows.map((row) => ({
        id: row.id,
        ownerId: row.user_id,
        ownerUsername: row.username,
        name: row.name,
        timeZone: row.time_zone,
      }))
    );
  })
);

teamsRouter.get(
  "/:teamId/bookings",
  handler(async (req, res) => {
    const teamId = paramInt(req.params.teamId, "teamId");
    await assertTeamRole(currentUser(req).id, teamId, ["OWNER", "ADMIN"]);
    const status = optStr(req.query as Record<string, unknown>, "status");
    const rows = await query<BookingRow>(
      `SELECT b.* FROM bookings b
       JOIN event_types e ON e.id = b.event_type_id
       WHERE e.team_id = $1
         AND ($2::text IS NULL OR
              ($2 = 'upcoming' AND b.status IN ('accepted','pending') AND b.end_time >= now()) OR
              ($2 = 'past' AND b.end_time < now() AND b.status <> 'cancelled') OR
              ($2 = 'cancelled' AND b.status IN ('cancelled','rejected')) OR
              ($2 = 'unconfirmed' AND b.status = 'pending'))
       ORDER BY b.start_time DESC
       LIMIT 200`,
      [teamId, status ?? null]
    );
    ok(res, await Promise.all(rows.map(presentBooking)));
  })
);

teamsRouter.get(
  "/:teamId/users/:userId/ooo",
  handler(async (req, res) => {
    const teamId = paramInt(req.params.teamId, "teamId");
    await assertTeamRole(currentUser(req).id, teamId, ["OWNER", "ADMIN"]);
    const userId = paramInt(req.params.userId, "userId");
    const member = await queryOne(
      "SELECT 1 FROM memberships WHERE team_id = $1 AND user_id = $2 AND accepted = TRUE",
      [teamId, userId]
    );
    if (!member) throw notFound("That user is not a member of this team");
    const rows = await query(
      `SELECT id, uuid, user_id, start_date, end_date, reason, notes, to_user_id
       FROM out_of_office WHERE user_id = $1 ORDER BY start_date DESC`,
      [userId]
    );
    ok(res, rows);
  })
);
