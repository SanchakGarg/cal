import { Router } from "express";
import { handler, ok } from "../../http/respond.ts";
import { badRequest } from "../../http/errors.ts";
import {
  asObject,
  array,
  bool,
  dateISO,
  optArray,
  optBool,
  optStr,
  optTimeZone,
  paramInt,
  str,
  timeHHMM,
  timeZone,
  weekDayToNumber,
} from "../../http/validate.ts";
import { currentUser, requireAuth } from "../../auth/middleware.ts";
import {
  type AvailabilityInput,
  type OverrideInput,
  createSchedule,
  deleteSchedule,
  getDefaultSchedule,
  getScheduleDetail,
  listSchedules,
  updateSchedule,
} from "./repo.ts";

export function parseAvailability(raw: unknown[]): AvailabilityInput[] {
  return raw.map((entry, index) => {
    const item = asObject(entry, `availability[${index}]`);
    const days = array(item, "days", { required: true }).map((day) =>
      weekDayToNumber(day, `availability[${index}].days`)
    );
    const startTime = timeHHMM(item.startTime, `availability[${index}].startTime`);
    const endTime = timeHHMM(item.endTime, `availability[${index}].endTime`);
    if (startTime >= endTime) {
      throw badRequest(`availability[${index}].endTime must be after startTime`);
    }
    return { days, startTime, endTime };
  });
}

export function parseOverrides(raw: unknown[]): OverrideInput[] {
  return raw.map((entry, index) => {
    const item = asObject(entry, `overrides[${index}]`);
    const date = dateISO(item.date, `overrides[${index}].date`);
    const hasTimes = item.startTime !== undefined && item.startTime !== null;
    if (!hasTimes) {
      // No times = the date is blocked out entirely.
      return { date, startTime: null, endTime: null };
    }
    const startTime = timeHHMM(item.startTime, `overrides[${index}].startTime`);
    const endTime = timeHHMM(item.endTime, `overrides[${index}].endTime`);
    if (startTime >= endTime) {
      throw badRequest(`overrides[${index}].endTime must be after startTime`);
    }
    return { date, startTime, endTime };
  });
}

export const schedulesRouter: Router = Router();

schedulesRouter.use(requireAuth);

schedulesRouter.post(
  "/",
  handler(async (req, res) => {
    const user = currentUser(req);
    const body = asObject(req.body);
    const availability = optArray(body, "availability");
    const overrides = optArray(body, "overrides");
    const scheduleId = await createSchedule(user.id, {
      name: str(body, "name", { max: 120 }),
      timeZone: timeZone(body, "timeZone"),
      isDefault: bool(body, "isDefault", false),
      availability: availability ? parseAvailability(availability) : undefined,
      overrides: overrides ? parseOverrides(overrides) : undefined,
    });
    ok(res, await getScheduleDetail(scheduleId, user.id), 201);
  })
);

schedulesRouter.get(
  "/",
  handler(async (req, res) => {
    ok(res, await listSchedules(currentUser(req).id));
  })
);

schedulesRouter.get(
  "/default",
  handler(async (req, res) => {
    ok(res, await getDefaultSchedule(currentUser(req).id));
  })
);

schedulesRouter.get(
  "/:scheduleId",
  handler(async (req, res) => {
    const scheduleId = paramInt(req.params.scheduleId, "scheduleId");
    ok(res, await getScheduleDetail(scheduleId, currentUser(req).id));
  })
);

schedulesRouter.patch(
  "/:scheduleId",
  handler(async (req, res) => {
    const user = currentUser(req);
    const scheduleId = paramInt(req.params.scheduleId, "scheduleId");
    const body = asObject(req.body);
    const availability = optArray(body, "availability");
    const overrides = optArray(body, "overrides");
    await updateSchedule(scheduleId, user.id, {
      name: optStr(body, "name", { max: 120 }),
      timeZone: optTimeZone(body, "timeZone"),
      isDefault: optBool(body, "isDefault"),
      excludeFromTeam: optBool(body, "excludeFromTeam"),
      availability: availability ? parseAvailability(availability) : undefined,
      overrides: overrides ? parseOverrides(overrides) : undefined,
    });
    ok(res, await getScheduleDetail(scheduleId, user.id));
  })
);

schedulesRouter.delete(
  "/:scheduleId",
  handler(async (req, res) => {
    const scheduleId = paramInt(req.params.scheduleId, "scheduleId");
    await deleteSchedule(scheduleId, currentUser(req).id);
    ok(res, { id: scheduleId });
  })
);
