// Demo data: two users with different availability, a team with a collective and
// a round-robin event, plus a few bookings. Safe to re-run.

import { randomUUID } from "node:crypto";
import { pool, query, queryOne } from "./pool.ts";
import { createDefaultEventTypes, createDefaultSchedule, createUser } from "../auth/users.ts";

interface SeedUser {
  email: string;
  name: string;
  username: string;
  timeZone: string;
  weekly: Array<{ days: number[]; start: string; end: string }>;
}

const USERS: SeedUser[] = [
  {
    email: "alice@example.com",
    name: "Alice Kapoor",
    username: "alice",
    timeZone: "Asia/Kolkata",
    weekly: [{ days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" }],
  },
  {
    email: "bob@example.com",
    name: "Bob Mensah",
    username: "bob",
    timeZone: "Europe/London",
    weekly: [
      { days: [1, 2, 3, 4, 5], start: "13:00", end: "18:00" },
      { days: [6], start: "10:00", end: "14:00" },
    ],
  },
];

async function upsertUser(seed: SeedUser): Promise<number> {
  const existing = await queryOne<{ id: number }>("SELECT id FROM users WHERE email = $1", [
    seed.email,
  ]);
  if (existing) {
    console.log(`= user ${seed.username}`);
    return existing.id;
  }
  const user = await createUser({
    email: seed.email,
    name: seed.name,
    username: seed.username,
    timeZone: seed.timeZone,
  });
  const scheduleId = await createDefaultSchedule(user.id, seed.timeZone);
  await query("DELETE FROM availability WHERE schedule_id = $1", [scheduleId]);
  for (const block of seed.weekly) {
    for (const day of block.days) {
      await query(
        "INSERT INTO availability (schedule_id, day, start_time, end_time) VALUES ($1, $2, $3, $4)",
        [scheduleId, day, block.start, block.end]
      );
    }
  }
  await createDefaultEventTypes(user.id, scheduleId);
  await query("UPDATE users SET completed_onboarding = TRUE WHERE id = $1", [user.id]);
  console.log(`+ user ${seed.username} (schedule ${scheduleId})`);
  return user.id;
}

async function main(): Promise<void> {
  const [aliceId, bobId] = await Promise.all(USERS.map(upsertUser));

  // A date override on Alice: next Monday only 13:00-15:00.
  const monday = nextWeekday(1);
  const aliceSchedule = await queryOne<{ default_schedule_id: number }>(
    "SELECT default_schedule_id FROM users WHERE id = $1",
    [aliceId]
  );
  if (aliceSchedule?.default_schedule_id) {
    await query("DELETE FROM date_overrides WHERE schedule_id = $1 AND date = $2", [
      aliceSchedule.default_schedule_id,
      monday,
    ]);
    await query(
      "INSERT INTO date_overrides (schedule_id, date, start_time, end_time) VALUES ($1, $2, '13:00', '15:00')",
      [aliceSchedule.default_schedule_id, monday]
    );
    console.log(`+ date override for alice on ${monday} 13:00-15:00`);
  }

  // Organization + team with both scheduling types.
  let org = await queryOne<{ id: number }>(
    "SELECT id FROM teams WHERE slug = 'acme' AND is_organization = TRUE"
  );
  if (!org) {
    org = await queryOne<{ id: number }>(
      `INSERT INTO teams (name, slug, is_organization, time_zone) VALUES ('Acme Inc', 'acme', TRUE, 'Europe/London')
       RETURNING id`
    );
    console.log("+ organization acme");
  }
  for (const [userId, role] of [
    [aliceId, "OWNER"],
    [bobId, "MEMBER"],
  ] as Array<[number, string]>) {
    await query(
      `INSERT INTO memberships (user_id, team_id, role, accepted) VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (user_id, team_id) DO UPDATE SET role = EXCLUDED.role, accepted = TRUE`,
      [userId, org!.id, role]
    );
    await query("UPDATE users SET organization_id = $1 WHERE id = $2", [org!.id, userId]);
  }

  let team = await queryOne<{ id: number }>(
    "SELECT id FROM teams WHERE slug = 'sales' AND parent_id = $1",
    [org!.id]
  );
  if (!team) {
    team = await queryOne<{ id: number }>(
      `INSERT INTO teams (name, slug, parent_id, time_zone) VALUES ('Sales', 'sales', $1, 'Europe/London')
       RETURNING id`,
      [org!.id]
    );
    console.log("+ team sales");
  }
  for (const [userId, role] of [
    [aliceId, "OWNER"],
    [bobId, "MEMBER"],
  ] as Array<[number, string]>) {
    await query(
      `INSERT INTO memberships (user_id, team_id, role, accepted) VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (user_id, team_id) DO UPDATE SET accepted = TRUE`,
      [userId, team!.id, role]
    );
  }

  const teamEvents: Array<{
    title: string;
    slug: string;
    length: number;
    type: "collective" | "roundRobin";
  }> = [
    { title: "Product Demo (collective)", slug: "demo", length: 30, type: "collective" },
    { title: "Sales Intro (round robin)", slug: "intro", length: 15, type: "roundRobin" },
  ];
  for (const event of teamEvents) {
    let row = await queryOne<{ id: number }>(
      "SELECT id FROM event_types WHERE team_id = $1 AND slug = $2",
      [team!.id, event.slug]
    );
    if (!row) {
      row = await queryOne<{ id: number }>(
        `INSERT INTO event_types (team_id, title, slug, length_in_minutes, scheduling_type, locations)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
        [
          team!.id,
          event.title,
          event.slug,
          event.length,
          event.type,
          JSON.stringify([{ type: "integration", integration: "cal-video" }]),
        ]
      );
      console.log(`+ team event ${event.slug} (${event.type})`);
    }
    for (const userId of [aliceId, bobId]) {
      await query(
        `INSERT INTO event_type_hosts (event_type_id, user_id, mandatory)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [row!.id, userId, event.type === "collective"]
      );
    }
  }

  // One accepted booking on Alice's 30 minute event, tomorrow.
  const aliceEvent = await queryOne<{ id: number; title: string }>(
    "SELECT id, title FROM event_types WHERE owner_id = $1 AND slug = '30min'",
    [aliceId]
  );
  if (aliceEvent) {
    const existing = await queryOne(
      "SELECT 1 FROM bookings WHERE event_type_id = $1 AND status = 'accepted'",
      [aliceEvent.id]
    );
    if (!existing) {
      const start = nextWeekdayAt(2, 10);
      const uid = randomUUID();
      const booking = await queryOne<{ id: number }>(
        `INSERT INTO bookings (uid, event_type_id, user_id, title, start_time, end_time, status, location, ics_uid)
         VALUES ($1, $2, $3, $4, $5, $6, 'accepted', 'cal-video', $7) RETURNING id`,
        [
          uid,
          aliceEvent.id,
          aliceId,
          `${aliceEvent.title} between Alice Kapoor and Dana Reed`,
          start,
          new Date(start.getTime() + 30 * 60000),
          `${uid}@cal.local`,
        ]
      );
      await query("INSERT INTO booking_hosts (booking_id, user_id) VALUES ($1, $2)", [
        booking!.id,
        aliceId,
      ]);
      await query(
        `INSERT INTO booking_attendees (booking_id, name, email, time_zone)
         VALUES ($1, 'Dana Reed', 'dana@example.com', 'America/New_York')`,
        [booking!.id]
      );
      console.log(`+ booking on ${start.toISOString()}`);
    }
  }

  console.log("seed complete");
}

function nextWeekday(weekday: number): string {
  const now = new Date();
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let index = 1; index <= 14; index += 1) {
    const candidate = new Date(cursor.getTime() + index * 86400000);
    if (candidate.getUTCDay() === weekday) return candidate.toISOString().slice(0, 10);
  }
  return cursor.toISOString().slice(0, 10);
}

function nextWeekdayAt(daysAhead: number, hourUtc: number): Date {
  const now = new Date();
  const base = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysAhead, hourUtc, 0, 0)
  );
  // Push to Monday if it lands on a weekend, so it sits inside working hours.
  const day = base.getUTCDay();
  if (day === 0) return new Date(base.getTime() + 86400000);
  if (day === 6) return new Date(base.getTime() + 2 * 86400000);
  return base;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => pool.end());
