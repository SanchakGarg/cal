import { randomUUID } from "node:crypto";
import { Router } from "express";
import { query, queryOne } from "../../db/pool.ts";
import { badRequest, notFound } from "../../http/errors.ts";
import { handler, ok } from "../../http/respond.ts";
import {
  asObject,
  dateISO,
  oneOf,
  optInt,
  optStr,
  optTimeZone,
  paramInt,
  slugify,
} from "../../http/validate.ts";
import { currentUser, requireAuth } from "../../auth/middleware.ts";
import { type OooRow, type UserRecord, serializeMe, serializeOoo } from "../serialize.ts";

const SELECT_ME = `
  SELECT id, username, email, name, avatar_url, bio, time_zone, week_start, time_format,
         locale, default_schedule_id, organization_id, is_guest, completed_onboarding
  FROM users WHERE id = $1`;

const OOO_REASONS = ["unspecified", "vacation", "travel", "sick", "public_holiday"] as const;

async function loadMe(userId: number) {
  const user = await queryOne<UserRecord>(SELECT_ME, [userId]);
  if (!user) throw notFound("User not found");
  const organization = user.organization_id
    ? await queryOne<{ id: number; slug: string | null }>(
        "SELECT id, slug FROM teams WHERE id = $1",
        [user.organization_id]
      )
    : null;
  return serializeMe(user, organization);
}

export const meRouter: Router = Router();

meRouter.use(requireAuth);

meRouter.get(
  "/",
  handler(async (req, res) => {
    ok(res, await loadMe(currentUser(req).id));
  })
);

meRouter.patch(
  "/",
  handler(async (req, res) => {
    const user = currentUser(req);
    const body = asObject(req.body);
    const username = optStr(body, "username", { max: 64 });
    if (username) {
      const slug = slugify(username);
      const taken = await queryOne("SELECT 1 FROM users WHERE username = $1 AND id <> $2", [
        slug,
        user.id,
      ]);
      if (taken) throw badRequest("That username is already taken");
      body.username = slug;
    }
    const timeFormat = optInt(body, "timeFormat");
    if (timeFormat !== undefined && timeFormat !== 12 && timeFormat !== 24) {
      throw badRequest("timeFormat must be 12 or 24");
    }

    await query(
      `UPDATE users SET
         username = COALESCE($2, username),
         name = COALESCE($3, name),
         email = COALESCE($4, email),
         bio = COALESCE($5, bio),
         avatar_url = COALESCE($6, avatar_url),
         time_zone = COALESCE($7, time_zone),
         week_start = COALESCE($8, week_start),
         time_format = COALESCE($9, time_format),
         locale = COALESCE($10, locale),
         default_schedule_id = COALESCE($11, default_schedule_id),
         completed_onboarding = COALESCE($12, completed_onboarding),
         updated_at = now()
       WHERE id = $1`,
      [
        user.id,
        body.username ?? null,
        optStr(body, "name", { max: 120 }) ?? null,
        optStr(body, "email", { max: 200 }) ?? null,
        optStr(body, "bio", { max: 2000 }) ?? null,
        optStr(body, "avatarUrl", { max: 500 }) ?? null,
        optTimeZone(body, "timeZone") ?? null,
        oneOf(body, "weekStart", ["Sunday", "Monday", "Saturday"] as const) ?? null,
        timeFormat ?? null,
        optStr(body, "locale", { max: 10 }) ?? null,
        optInt(body, "defaultScheduleId") ?? null,
        body.completedOnboarding === undefined ? null : Boolean(body.completedOnboarding),
      ]
    );
    ok(res, await loadMe(user.id));
  })
);

// Personal booking limits live in users.metadata so they can be cleared wholesale.
meRouter.get(
  "/booking-limits",
  handler(async (req, res) => {
    const row = await queryOne<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM users WHERE id = $1",
      [currentUser(req).id]
    );
    ok(res, (row?.metadata?.bookingLimits as unknown) ?? { disabled: true });
  })
);

meRouter.patch(
  "/booking-limits",
  handler(async (req, res) => {
    const body = asObject(req.body);
    const limits = {
      day: optInt(body, "day", { min: 1 }) ?? null,
      week: optInt(body, "week", { min: 1 }) ?? null,
      month: optInt(body, "month", { min: 1 }) ?? null,
      year: optInt(body, "year", { min: 1 }) ?? null,
    };
    await query(
      `UPDATE users SET metadata = jsonb_set(metadata, '{bookingLimits}', $2::jsonb, true) WHERE id = $1`,
      [currentUser(req).id, JSON.stringify(limits)]
    );
    ok(res, limits);
  })
);

meRouter.delete(
  "/booking-limits",
  handler(async (req, res) => {
    await query("UPDATE users SET metadata = metadata - 'bookingLimits' WHERE id = $1", [
      currentUser(req).id,
    ]);
    ok(res, { disabled: true });
  })
);

meRouter.get(
  "/ooo",
  handler(async (req, res) => {
    const rows = await query<OooRow>(
      `SELECT id, uuid, user_id, start_date, end_date, reason, notes, to_user_id
       FROM out_of_office WHERE user_id = $1 ORDER BY start_date DESC`,
      [currentUser(req).id]
    );
    ok(res, rows.map(serializeOoo));
  })
);

meRouter.post(
  "/ooo",
  handler(async (req, res) => {
    const user = currentUser(req);
    const body = asObject(req.body);
    const start = dateISO(body.start, "start");
    const end = dateISO(body.end, "end");
    if (end < start) throw badRequest("end must be on or after start");

    const row = await queryOne<OooRow>(
      `INSERT INTO out_of_office (uuid, user_id, start_date, end_date, reason, notes, to_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, uuid, user_id, start_date, end_date, reason, notes, to_user_id`,
      [
        randomUUID(),
        user.id,
        start,
        end,
        oneOf(body, "reason", OOO_REASONS) ?? "unspecified",
        optStr(body, "notes", { max: 1000 }) ?? null,
        optInt(body, "toUserId") ?? null,
      ]
    );
    ok(res, serializeOoo(row!), 201);
  })
);

meRouter.patch(
  "/ooo/:oooId",
  handler(async (req, res) => {
    const user = currentUser(req);
    const oooId = paramInt(req.params.oooId, "oooId");
    const body = asObject(req.body);
    const row = await queryOne<OooRow>(
      `UPDATE out_of_office SET
         start_date = COALESCE($3, start_date),
         end_date = COALESCE($4, end_date),
         reason = COALESCE($5, reason),
         notes = COALESCE($6, notes),
         to_user_id = COALESCE($7, to_user_id)
       WHERE id = $1 AND user_id = $2
       RETURNING id, uuid, user_id, start_date, end_date, reason, notes, to_user_id`,
      [
        oooId,
        user.id,
        body.start === undefined ? null : dateISO(body.start, "start"),
        body.end === undefined ? null : dateISO(body.end, "end"),
        oneOf(body, "reason", OOO_REASONS) ?? null,
        optStr(body, "notes", { max: 1000 }) ?? null,
        optInt(body, "toUserId") ?? null,
      ]
    );
    if (!row) throw notFound("Out of office entry not found");
    ok(res, serializeOoo(row));
  })
);

meRouter.delete(
  "/ooo/:oooId",
  handler(async (req, res) => {
    const oooId = paramInt(req.params.oooId, "oooId");
    const row = await queryOne<{ id: number }>(
      "DELETE FROM out_of_office WHERE id = $1 AND user_id = $2 RETURNING id",
      [oooId, currentUser(req).id]
    );
    if (!row) throw notFound("Out of office entry not found");
    ok(res, { id: row.id });
  })
);
