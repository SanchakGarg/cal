import { randomBytes, randomUUID } from "node:crypto";
import { query, queryOne } from "../db/pool.ts";
import { slugify } from "../http/validate.ts";

export interface UserRow {
  id: number;
  uid: string;
  username: string;
  email: string;
  name: string;
  organization_id: number | null;
  is_guest: boolean;
  completed_onboarding: boolean;
}

const SELECT_COLUMNS =
  "id, uid, username, email, name, organization_id, is_guest, completed_onboarding";

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  return queryOne<UserRow>(`SELECT ${SELECT_COLUMNS} FROM users WHERE lower(email) = lower($1)`, [
    email,
  ]);
}

export async function findUserBySubject(subject: string): Promise<UserRow | null> {
  return queryOne<UserRow>(`SELECT ${SELECT_COLUMNS} FROM users WHERE oidc_subject = $1`, [subject]);
}

export async function findUserByGoogleSubject(subject: string): Promise<UserRow | null> {
  return queryOne<UserRow>(`SELECT ${SELECT_COLUMNS} FROM users WHERE google_subject = $1`, [
    subject,
  ]);
}

/** Finds a free username, appending a counter when the base is taken. */
export async function uniqueUsername(base: string): Promise<string> {
  const seed = slugify(base) || `user-${randomBytes(3).toString("hex")}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? seed : `${seed}-${attempt}`;
    const taken = await queryOne("SELECT 1 FROM users WHERE username = $1", [candidate]);
    if (!taken) return candidate;
  }
  return `${seed}-${randomBytes(3).toString("hex")}`;
}

export interface CreateUserInput {
  email: string;
  name?: string;
  username?: string;
  timeZone?: string;
  isGuest?: boolean;
  oidcSubject?: string | null;
  googleSubject?: string | null;
  avatarUrl?: string | null;
}

export async function createUser(input: CreateUserInput): Promise<UserRow> {
  const username = await uniqueUsername(input.username ?? input.name ?? input.email.split("@")[0]);
  const rows = await query<UserRow>(
    `INSERT INTO users (uid, username, email, name, time_zone, is_guest, oidc_subject,
                        google_subject, avatar_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${SELECT_COLUMNS}`,
    [
      randomUUID(),
      username,
      input.email,
      input.name ?? username,
      input.timeZone ?? "Europe/London",
      input.isGuest ?? false,
      input.oidcSubject ?? null,
      input.googleSubject ?? null,
      input.avatarUrl ?? null,
    ]
  );
  return rows[0];
}

/** Default Mon–Fri 9–5 schedule, same starting point cal.com gives new users. */
export async function createDefaultSchedule(userId: number, timeZone: string): Promise<number> {
  const schedule = await queryOne<{ id: number }>(
    "INSERT INTO schedules (user_id, name, time_zone) VALUES ($1, 'Working Hours', $2) RETURNING id",
    [userId, timeZone]
  );
  const scheduleId = schedule!.id;
  for (const day of [1, 2, 3, 4, 5]) {
    await query(
      "INSERT INTO availability (schedule_id, day, start_time, end_time) VALUES ($1, $2, '09:00', '17:00')",
      [scheduleId, day]
    );
  }
  await query("UPDATE users SET default_schedule_id = $1 WHERE id = $2", [scheduleId, userId]);
  return scheduleId;
}

/** Two starter event types, mirroring cal.com's onboarding. */
export async function createDefaultEventTypes(userId: number, scheduleId: number): Promise<void> {
  const defaults = [
    { title: "15 Min Meeting", slug: "15min", length: 15 },
    { title: "30 Min Meeting", slug: "30min", length: 30 },
  ];
  for (const eventType of defaults) {
    await query(
      `INSERT INTO event_types (owner_id, title, slug, length_in_minutes, schedule_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [userId, eventType.title, eventType.slug, eventType.length, scheduleId]
    );
  }
}

export async function bootstrapNewUser(user: UserRow, timeZone: string): Promise<void> {
  const scheduleId = await createDefaultSchedule(user.id, timeZone);
  await createDefaultEventTypes(user.id, scheduleId);
}
