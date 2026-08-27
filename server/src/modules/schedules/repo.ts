import { type Tx, query, queryOne, withTransaction } from "../../db/pool.ts";
import { notFound } from "../../http/errors.ts";
import {
  type AvailabilityRow,
  type OverrideRow,
  type ScheduleRow,
  serializeSchedule,
} from "../serialize.ts";

export interface AvailabilityInput {
  days: number[];
  startTime: string;
  endTime: string;
}

export interface OverrideInput {
  date: string;
  startTime: string | null;
  endTime: string | null;
}

export interface ScheduleInput {
  name: string;
  timeZone: string;
  isDefault: boolean;
  /** Keep this schedule out of team events, collective ones included. */
  excludeFromTeam?: boolean;
  availability?: AvailabilityInput[];
  overrides?: OverrideInput[];
}

export const DEFAULT_AVAILABILITY: AvailabilityInput[] = [
  { days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00" },
];

async function replaceAvailability(
  tx: Tx,
  scheduleId: number,
  availability: AvailabilityInput[]
): Promise<void> {
  await tx.query("DELETE FROM availability WHERE schedule_id = $1", [scheduleId]);
  for (const entry of availability) {
    for (const day of entry.days) {
      await tx.query(
        "INSERT INTO availability (schedule_id, day, start_time, end_time) VALUES ($1, $2, $3, $4)",
        [scheduleId, day, entry.startTime, entry.endTime]
      );
    }
  }
}

async function replaceOverrides(
  tx: Tx,
  scheduleId: number,
  overrides: OverrideInput[]
): Promise<void> {
  await tx.query("DELETE FROM date_overrides WHERE schedule_id = $1", [scheduleId]);
  for (const override of overrides) {
    await tx.query(
      "INSERT INTO date_overrides (schedule_id, date, start_time, end_time) VALUES ($1, $2, $3, $4)",
      [scheduleId, override.date, override.startTime, override.endTime]
    );
  }
}

export async function createSchedule(userId: number, input: ScheduleInput) {
  return withTransaction(async (tx) => {
    const schedule = await tx.queryOne<ScheduleRow>(
      "INSERT INTO schedules (user_id, name, time_zone) VALUES ($1, $2, $3) RETURNING id, user_id, name, time_zone",
      [userId, input.name, input.timeZone]
    );
    const scheduleId = schedule!.id;
    await replaceAvailability(tx, scheduleId, input.availability ?? DEFAULT_AVAILABILITY);
    await replaceOverrides(tx, scheduleId, input.overrides ?? []);

    const current = await tx.queryOne<{ default_schedule_id: number | null }>(
      "SELECT default_schedule_id FROM users WHERE id = $1",
      [userId]
    );
    if (input.isDefault || current?.default_schedule_id === null) {
      await tx.query("UPDATE users SET default_schedule_id = $1 WHERE id = $2", [scheduleId, userId]);
    }
    return scheduleId;
  });
}

export async function updateSchedule(
  scheduleId: number,
  userId: number,
  input: Partial<ScheduleInput>
): Promise<void> {
  await withTransaction(async (tx) => {
    const existing = await tx.queryOne<ScheduleRow>(
      "SELECT id, user_id, name, time_zone, exclude_from_team FROM schedules WHERE id = $1 AND user_id = $2",
      [scheduleId, userId]
    );
    if (!existing) throw notFound("Schedule not found");

    if (
      input.name !== undefined ||
      input.timeZone !== undefined ||
      input.excludeFromTeam !== undefined
    ) {
      await tx.query(
        `UPDATE schedules
         SET name = COALESCE($2, name), time_zone = COALESCE($3, time_zone),
             exclude_from_team = COALESCE($4, exclude_from_team), updated_at = now()
         WHERE id = $1`,
        [scheduleId, input.name ?? null, input.timeZone ?? null, input.excludeFromTeam ?? null]
      );
    }
    if (input.availability !== undefined) {
      await replaceAvailability(tx, scheduleId, input.availability);
    }
    if (input.overrides !== undefined) {
      await replaceOverrides(tx, scheduleId, input.overrides);
    }
    if (input.isDefault === true) {
      await tx.query("UPDATE users SET default_schedule_id = $1 WHERE id = $2", [scheduleId, userId]);
    }
  });
}

export async function getScheduleDetail(scheduleId: number, userId?: number) {
  const schedule = await queryOne<ScheduleRow>(
    `SELECT id, user_id, name, time_zone, exclude_from_team FROM schedules
     WHERE id = $1 ${userId !== undefined ? "AND user_id = $2" : ""}`,
    userId !== undefined ? [scheduleId, userId] : [scheduleId]
  );
  if (!schedule) throw notFound("Schedule not found");
  return buildDetail(schedule);
}

export async function listSchedules(userId: number) {
  const schedules = await query<ScheduleRow>(
    "SELECT id, user_id, name, time_zone, exclude_from_team FROM schedules WHERE user_id = $1 ORDER BY id",
    [userId]
  );
  return Promise.all(schedules.map(buildDetail));
}

export async function getDefaultSchedule(userId: number) {
  const schedule = await queryOne<ScheduleRow>(
    `SELECT s.id, s.user_id, s.name, s.time_zone
     FROM schedules s
     JOIN users u ON u.default_schedule_id = s.id
     WHERE u.id = $1`,
    [userId]
  );
  if (!schedule) throw notFound("No default schedule set");
  return buildDetail(schedule);
}

export async function deleteSchedule(scheduleId: number, userId: number): Promise<void> {
  const deleted = await queryOne<{ id: number }>(
    "DELETE FROM schedules WHERE id = $1 AND user_id = $2 RETURNING id",
    [scheduleId, userId]
  );
  if (!deleted) throw notFound("Schedule not found");
}

async function buildDetail(schedule: ScheduleRow) {
  const [availability, overrides, owner] = await Promise.all([
    query<AvailabilityRow>(
      "SELECT day, start_time, end_time FROM availability WHERE schedule_id = $1 ORDER BY day, start_time",
      [schedule.id]
    ),
    query<OverrideRow>(
      "SELECT date, start_time, end_time FROM date_overrides WHERE schedule_id = $1 ORDER BY date, start_time",
      [schedule.id]
    ),
    queryOne<{ default_schedule_id: number | null }>(
      "SELECT default_schedule_id FROM users WHERE id = $1",
      [schedule.user_id]
    ),
  ]);
  return serializeSchedule(schedule, availability, overrides, owner?.default_schedule_id ?? null);
}
