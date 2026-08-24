// Unauthenticated reads for the booker: profiles, event lists, private links.

import { Router } from "express";
import { query, queryOne } from "../../db/pool.ts";
import { notFound } from "../../http/errors.ts";
import { handler, ok } from "../../http/respond.ts";
import { type EventTypeRow, serializeTeam, type TeamRow } from "../serialize.ts";
import { present } from "../event-types/repo.ts";
import { TEAM_COLUMNS } from "../teams/repo.ts";

export const publicRouter: Router = Router();

publicRouter.get(
  "/users/:username",
  handler(async (req, res) => {
    const user = await queryOne<{
      id: number;
      username: string;
      name: string;
      bio: string | null;
      avatar_url: string | null;
      time_zone: string;
      week_start: string;
      time_format: number;
    }>(
      `SELECT id, username, name, bio, avatar_url, time_zone, week_start, time_format
       FROM users WHERE username = $1`,
      [String(req.params.username)]
    );
    if (!user) throw notFound("User not found");

    const rows = await query<EventTypeRow>(
      "SELECT * FROM event_types WHERE owner_id = $1 AND hidden = FALSE ORDER BY id",
      [user.id]
    );
    ok(res, {
      profile: {
        id: user.id,
        username: user.username,
        name: user.name,
        bio: user.bio,
        avatarUrl: user.avatar_url,
        timeZone: user.time_zone,
        weekStart: user.week_start,
        timeFormat: user.time_format,
      },
      eventTypes: await Promise.all(rows.map(present)),
    });
  })
);

publicRouter.get(
  "/teams/:slug",
  handler(async (req, res) => {
    const team = await queryOne<TeamRow>(
      `SELECT ${TEAM_COLUMNS} FROM teams WHERE slug = $1`,
      [String(req.params.slug)]
    );
    if (!team) throw notFound("Team not found");
    const rows = await query<EventTypeRow>(
      "SELECT * FROM event_types WHERE team_id = $1 AND hidden = FALSE ORDER BY id",
      [team.id]
    );
    const members = team.hide_book_a_team_member
      ? []
      : await query(
          `SELECT u.id, u.name, u.username, u.avatar_url AS "avatarUrl"
           FROM memberships m JOIN users u ON u.id = m.user_id
           WHERE m.team_id = $1 AND m.accepted = TRUE ORDER BY u.id`,
          [team.id]
        );
    ok(res, {
      profile: serializeTeam(team),
      members,
      eventTypes: await Promise.all(rows.map(present)),
    });
  })
);

/** Private links: resolve to their event type and count the usage. */
publicRouter.get(
  "/private-links/:linkId",
  handler(async (req, res) => {
    const link = await queryOne<{
      id: number;
      event_type_id: number;
      expires_at: Date | null;
      max_usage_count: number | null;
      usage_count: number;
    }>(
      `SELECT id, event_type_id, expires_at, max_usage_count, usage_count
       FROM private_links WHERE link_id = $1`,
      [String(req.params.linkId)]
    );
    if (!link) throw notFound("Link not found");
    if (link.expires_at && link.expires_at.getTime() < Date.now()) throw notFound("Link has expired");
    if (link.max_usage_count !== null && link.usage_count >= link.max_usage_count) {
      throw notFound("Link has reached its usage limit");
    }
    await query("UPDATE private_links SET usage_count = usage_count + 1 WHERE id = $1", [link.id]);

    const eventType = await queryOne<EventTypeRow>("SELECT * FROM event_types WHERE id = $1", [
      link.event_type_id,
    ]);
    if (!eventType) throw notFound("Event type not found");
    ok(res, await present(eventType));
  })
);
