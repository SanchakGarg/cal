import { Router } from "express";
import { query, queryOne } from "../../db/pool.ts";
import { badRequest, forbidden, notFound } from "../../http/errors.ts";
import { handler, ok } from "../../http/respond.ts";
import { asObject, instant, optInt, optStr, paramInt } from "../../http/validate.ts";
import { currentUser, optionalAuth, requireAuth } from "../../auth/middleware.ts";
import { parseEventTypeInput } from "./input.ts";
import {
  assertCanManage,
  createEventType,
  createPrivateLink,
  deleteEventType,
  deletePrivateLink,
  findEventTypeById,
  findPublicEventType,
  listPersonalEventTypes,
  listPrivateLinks,
  present,
  updateEventType,
  updatePrivateLink,
} from "./repo.ts";

export const eventTypesRouter: Router = Router();

// Public read: the booker resolves an event type by username/team slug + slug.
eventTypesRouter.get(
  "/",
  optionalAuth,
  handler(async (req, res) => {
    const username = optStr(req.query as Record<string, unknown>, "username");
    const eventSlug = optStr(req.query as Record<string, unknown>, "eventSlug");
    const teamSlug = optStr(req.query as Record<string, unknown>, "teamSlug");

    if (eventSlug && (username || teamSlug)) {
      const row = await findPublicEventType({ username, teamSlug, eventSlug });
      if (!row) throw notFound("Event type not found");
      ok(res, [await present(row)]);
      return;
    }
    if (username || teamSlug) {
      const rows = teamSlug
        ? await query(
            `SELECT e.* FROM event_types e JOIN teams t ON t.id = e.team_id
             WHERE t.slug = $1 AND e.hidden = FALSE ORDER BY e.id`,
            [teamSlug]
          )
        : await query(
            `SELECT e.* FROM event_types e JOIN users u ON u.id = e.owner_id
             WHERE u.username = $1 AND e.hidden = FALSE ORDER BY e.id`,
            [username]
          );
      ok(res, await Promise.all(rows.map((row) => present(row as never))));
      return;
    }
    if (!req.user) throw forbidden("Provide username or teamSlug, or authenticate");
    ok(res, await listPersonalEventTypes(req.user.id));
  })
);

eventTypesRouter.post(
  "/",
  requireAuth,
  handler(async (req, res) => {
    const user = currentUser(req);
    const { columns } = parseEventTypeInput(req.body);
    if (columns.schedule_id) {
      const owned = await queryOne("SELECT 1 FROM schedules WHERE id = $1 AND user_id = $2", [
        columns.schedule_id,
        user.id,
      ]);
      if (!owned) throw badRequest("scheduleId must be one of your own schedules");
    }
    const row = await createEventType({
      ownerId: user.id,
      columns: { ...columns, schedule_id: columns.schedule_id ?? user.default_schedule_id },
    });
    ok(res, await present(row), 201);
  })
);

eventTypesRouter.get(
  "/:eventTypeId",
  optionalAuth,
  handler(async (req, res) => {
    const row = await findEventTypeById(paramInt(req.params.eventTypeId, "eventTypeId"));
    if (row.hidden) {
      if (!req.user) throw notFound("Event type not found");
      await assertCanManage(row, req.user.id);
    }
    ok(res, await present(row));
  })
);

eventTypesRouter.patch(
  "/:eventTypeId",
  requireAuth,
  handler(async (req, res) => {
    const user = currentUser(req);
    const row = await findEventTypeById(paramInt(req.params.eventTypeId, "eventTypeId"));
    await assertCanManage(row, user.id);
    const { columns, hosts } = parseEventTypeInput(req.body, {
      partial: true,
      team: row.team_id !== null,
    });
    const updated = await updateEventType(row.id, columns, hosts);
    ok(res, await present(updated));
  })
);

eventTypesRouter.delete(
  "/:eventTypeId",
  requireAuth,
  handler(async (req, res) => {
    const user = currentUser(req);
    const row = await findEventTypeById(paramInt(req.params.eventTypeId, "eventTypeId"));
    await assertCanManage(row, user.id);
    await deleteEventType(row.id);
    ok(res, { id: row.id, lengthInMinutes: row.length_in_minutes, title: row.title, slug: row.slug });
  })
);

/** Everything the booker needs to render availability rules in one call. */
eventTypesRouter.get(
  "/:eventTypeId/scheduling-config",
  optionalAuth,
  handler(async (req, res) => {
    const row = await findEventTypeById(paramInt(req.params.eventTypeId, "eventTypeId"));
    ok(res, {
      eventTypeId: row.id,
      lengthInMinutes: row.length_in_minutes,
      lengthInMinutesOptions: row.length_in_minutes_options,
      slotInterval: row.slot_interval,
      minimumBookingNotice: row.minimum_booking_notice,
      beforeEventBuffer: row.before_event_buffer,
      afterEventBuffer: row.after_event_buffer,
      offsetStart: row.offset_start,
      bookingWindow: row.booking_window,
      bookingLimitsCount: row.booking_limits_count,
      bookingLimitsDuration: row.booking_limits_duration,
      onlyShowFirstAvailableSlot: row.only_show_first_available_slot,
      schedulingType: row.scheduling_type,
      seatsPerTimeSlot: row.seats_per_time_slot,
      confirmationPolicy: row.confirmation_policy,
      recurrence: row.recurrence,
      bookerLayouts: row.booker_layouts,
      lockTimeZoneToggleOnBookingPage: row.lock_timezone_toggle,
    });
  })
);

eventTypesRouter.get(
  "/:eventTypeId/private-links",
  requireAuth,
  handler(async (req, res) => {
    const row = await findEventTypeById(paramInt(req.params.eventTypeId, "eventTypeId"));
    await assertCanManage(row, currentUser(req).id);
    ok(res, await listPrivateLinks(row.id));
  })
);

eventTypesRouter.post(
  "/:eventTypeId/private-links",
  requireAuth,
  handler(async (req, res) => {
    const row = await findEventTypeById(paramInt(req.params.eventTypeId, "eventTypeId"));
    await assertCanManage(row, currentUser(req).id);
    const body = asObject(req.body ?? {});
    const expiresAt = body.expiresAt === undefined ? null : instant(body.expiresAt, "expiresAt");
    ok(
      res,
      await createPrivateLink(row.id, {
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        maxUsageCount: optInt(body, "maxUsageCount", { min: 1 }) ?? null,
      }),
      201
    );
  })
);

eventTypesRouter.patch(
  "/:eventTypeId/private-links/:linkId",
  requireAuth,
  handler(async (req, res) => {
    const row = await findEventTypeById(paramInt(req.params.eventTypeId, "eventTypeId"));
    await assertCanManage(row, currentUser(req).id);
    const body = asObject(req.body ?? {});
    const expiresAt = body.expiresAt === undefined ? null : instant(body.expiresAt, "expiresAt");
    ok(
      res,
      await updatePrivateLink(row.id, String(req.params.linkId), {
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        maxUsageCount: optInt(body, "maxUsageCount", { min: 1 }) ?? null,
      })
    );
  })
);

eventTypesRouter.delete(
  "/:eventTypeId/private-links/:linkId",
  requireAuth,
  handler(async (req, res) => {
    const row = await findEventTypeById(paramInt(req.params.eventTypeId, "eventTypeId"));
    await assertCanManage(row, currentUser(req).id);
    await deletePrivateLink(row.id, String(req.params.linkId));
    ok(res, { linkId: String(req.params.linkId) });
  })
);
