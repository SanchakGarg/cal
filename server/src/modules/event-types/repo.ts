import { randomBytes } from "node:crypto";
import { query, queryOne, withTransaction } from "../../db/pool.ts";
import { badRequest, conflict, forbidden, notFound } from "../../http/errors.ts";
import {
  type EventTypeHostRecord,
  type EventTypeRow,
  type PrivateLinkRow,
  serializeEventType,
  serializePrivateLink,
} from "../serialize.ts";
import { DEFAULT_BOOKING_FIELDS, type EventTypeColumns, type HostInput } from "./input.ts";
import { env } from "../../env.ts";

export const EVENT_TYPE_COLUMNS = `
  id, owner_id, team_id, parent_id, title, slug, description, length_in_minutes,
  length_in_minutes_options, schedule_id, slot_interval, minimum_booking_notice,
  before_event_buffer, after_event_buffer, offset_start, hidden, disable_guests,
  requires_booker_email_verification, lock_timezone_toggle, only_show_first_available_slot,
  hide_calendar_notes, hide_calendar_event_details, hide_organizer_email, success_redirect_url,
  custom_name, interface_language, allow_rescheduling_past_bookings, disable_cancelling,
  disable_rescheduling, scheduling_type, assign_all_team_members, seats_per_time_slot,
  seats_show_attendee_info, seats_show_availability_count, locations, booking_fields,
  booking_limits_count, booking_limits_duration, booker_active_bookings_limit, booking_window,
  booker_layouts, confirmation_policy, recurrence, color, email_settings, metadata`;

export async function loadHosts(eventTypeId: number): Promise<EventTypeHostRecord[]> {
  return query<EventTypeHostRecord>(
    `SELECT h.user_id AS "userId", u.name, u.username, h.mandatory, h.priority, h.weight,
            u.avatar_url AS "avatarUrl"
     FROM event_type_hosts h
     JOIN users u ON u.id = h.user_id
     WHERE h.event_type_id = $1
     ORDER BY h.user_id`,
    [eventTypeId]
  );
}

async function ownerContext(row: EventTypeRow) {
  const [owner, team] = await Promise.all([
    row.owner_id
      ? queryOne<{ username: string }>("SELECT username FROM users WHERE id = $1", [row.owner_id])
      : null,
    row.team_id
      ? queryOne<{ slug: string | null }>("SELECT slug FROM teams WHERE id = $1", [row.team_id])
      : null,
  ]);
  return {
    ownerUsername: owner?.username ?? null,
    teamSlug: team?.slug ?? null,
    bookingUrlBase: env.webOrigin,
  };
}

export async function present(row: EventTypeRow) {
  const [hosts, context] = await Promise.all([loadHosts(row.id), ownerContext(row)]);
  return serializeEventType(row, { ...context, hosts });
}

export async function findEventTypeById(eventTypeId: number): Promise<EventTypeRow> {
  const row = await queryOne<EventTypeRow>(
    `SELECT ${EVENT_TYPE_COLUMNS} FROM event_types WHERE id = $1`,
    [eventTypeId]
  );
  if (!row) throw notFound("Event type not found");
  return row;
}

/** Personal event types belong to their owner; team ones to team admins/owners. */
export async function assertCanManage(row: EventTypeRow, userId: number): Promise<void> {
  if (row.owner_id === userId) return;
  if (row.team_id) {
    const membership = await queryOne<{ role: string }>(
      "SELECT role FROM memberships WHERE user_id = $1 AND team_id = $2 AND accepted = TRUE",
      [userId, row.team_id]
    );
    if (membership && (membership.role === "OWNER" || membership.role === "ADMIN")) return;
    const team = await queryOne<{ parent_id: number | null }>(
      "SELECT parent_id FROM teams WHERE id = $1",
      [row.team_id]
    );
    if (team?.parent_id) {
      const orgRole = await queryOne<{ role: string }>(
        "SELECT role FROM memberships WHERE user_id = $1 AND team_id = $2 AND accepted = TRUE",
        [userId, team.parent_id]
      );
      if (orgRole && (orgRole.role === "OWNER" || orgRole.role === "ADMIN")) return;
    }
  }
  throw forbidden("You cannot manage this event type");
}

export interface CreateOptions {
  ownerId?: number | null;
  teamId?: number | null;
  columns: EventTypeColumns;
  hosts?: HostInput[];
  assignAllTeamMembers?: boolean;
}

const JSON_COLUMNS = new Set([
  "locations",
  "booking_fields",
  "booking_limits_count",
  "booking_limits_duration",
  "booker_active_bookings_limit",
  "booking_window",
  "booker_layouts",
  "confirmation_policy",
  "recurrence",
  "color",
  "email_settings",
  "metadata",
]);

export async function createEventType(options: CreateOptions): Promise<EventTypeRow> {
  const columns: EventTypeColumns = { ...options.columns };
  if (columns.booking_fields === undefined) {
    columns.booking_fields = JSON.stringify(DEFAULT_BOOKING_FIELDS);
  }
  if (columns.locations === undefined) {
    // No location by default: bookers see "to be confirmed" until one is set. We do
    // not ship a video provider, so pretending otherwise would be a lie.
    columns.locations = JSON.stringify([]);
  }

  const names = ["owner_id", "team_id", ...Object.keys(columns)];
  const values: unknown[] = [options.ownerId ?? null, options.teamId ?? null, ...Object.values(columns)];
  const placeholders = names.map((_, index) => `$${index + 1}`);

  return withTransaction(async (tx) => {
    const existing = await tx.queryOne<{ id: number }>(
      options.teamId
        ? "SELECT id FROM event_types WHERE team_id = $1 AND slug = $2"
        : "SELECT id FROM event_types WHERE owner_id = $1 AND slug = $2",
      [options.teamId ?? options.ownerId, columns.slug]
    );
    if (existing) throw conflict(`An event type with slug "${columns.slug}" already exists`);

    const inserted = await tx.queryOne<EventTypeRow>(
      `INSERT INTO event_types (${names.join(", ")}) VALUES (${placeholders.join(", ")})
       RETURNING ${EVENT_TYPE_COLUMNS}`,
      values
    );
    const row = inserted!;

    let hosts = options.hosts ?? [];
    if (options.teamId && options.assignAllTeamMembers) {
      const members = await tx.query<{ user_id: number }>(
        "SELECT user_id FROM memberships WHERE team_id = $1 AND accepted = TRUE",
        [options.teamId]
      );
      hosts = members.map((member) => ({
        userId: member.user_id,
        mandatory: row.scheduling_type === "collective",
        priority: "medium" as const,
        weight: 100,
      }));
    }
    if (options.teamId) {
      await replaceHostsTx(tx, row.id, options.teamId, hosts);
    }
    return row;
  });
}

export async function updateEventType(
  eventTypeId: number,
  columns: EventTypeColumns,
  hosts?: HostInput[]
): Promise<EventTypeRow> {
  return withTransaction(async (tx) => {
    const current = await tx.queryOne<EventTypeRow>(
      `SELECT ${EVENT_TYPE_COLUMNS} FROM event_types WHERE id = $1`,
      [eventTypeId]
    );
    if (!current) throw notFound("Event type not found");

    const entries = Object.entries(columns);
    if (entries.length > 0) {
      const assignments = entries.map(
        ([key], index) => `${key} = $${index + 2}${JSON_COLUMNS.has(key) ? "::jsonb" : ""}`
      );
      await tx.query(
        `UPDATE event_types SET ${assignments.join(", ")}, updated_at = now() WHERE id = $1`,
        [eventTypeId, ...entries.map(([, value]) => value)]
      );
    }
    if (hosts && current.team_id) {
      await replaceHostsTx(tx, eventTypeId, current.team_id, hosts);
    }
    const updated = await tx.queryOne<EventTypeRow>(
      `SELECT ${EVENT_TYPE_COLUMNS} FROM event_types WHERE id = $1`,
      [eventTypeId]
    );
    return updated!;
  });
}

async function replaceHostsTx(
  tx: { query: (text: string, params?: unknown[]) => Promise<unknown[]> },
  eventTypeId: number,
  teamId: number,
  hosts: HostInput[]
): Promise<void> {
  const members = (await tx.query(
    "SELECT user_id FROM memberships WHERE team_id = $1 AND accepted = TRUE",
    [teamId]
  )) as Array<{ user_id: number }>;
  const allowed = new Set(members.map((member) => member.user_id));
  for (const host of hosts) {
    if (!allowed.has(host.userId)) {
      throw badRequest(`User ${host.userId} is not an accepted member of this team`);
    }
  }
  await tx.query("DELETE FROM event_type_hosts WHERE event_type_id = $1", [eventTypeId]);
  for (const host of hosts) {
    await tx.query(
      `INSERT INTO event_type_hosts (event_type_id, user_id, mandatory, priority, weight)
       VALUES ($1, $2, $3, $4, $5)`,
      [eventTypeId, host.userId, host.mandatory, host.priority, host.weight]
    );
  }
}

export async function deleteEventType(eventTypeId: number): Promise<void> {
  await query("DELETE FROM event_types WHERE id = $1", [eventTypeId]);
}

export async function listPersonalEventTypes(userId: number) {
  const rows = await query<EventTypeRow>(
    `SELECT ${EVENT_TYPE_COLUMNS} FROM event_types WHERE owner_id = $1 AND team_id IS NULL ORDER BY id`,
    [userId]
  );
  return Promise.all(rows.map(present));
}

export async function listTeamEventTypes(teamId: number) {
  const rows = await query<EventTypeRow>(
    `SELECT ${EVENT_TYPE_COLUMNS} FROM event_types WHERE team_id = $1 ORDER BY id`,
    [teamId]
  );
  return Promise.all(rows.map(present));
}

/** Public lookup used by the booker: by username (or team slug) plus event slug. */
export async function findPublicEventType(params: {
  username?: string;
  teamSlug?: string;
  eventSlug: string;
}): Promise<EventTypeRow | null> {
  if (params.teamSlug) {
    return queryOne<EventTypeRow>(
      `SELECT e.* FROM event_types e
       JOIN teams t ON t.id = e.team_id
       WHERE t.slug = $1 AND e.slug = $2`,
      [params.teamSlug, params.eventSlug]
    );
  }
  if (!params.username) return null;
  return queryOne<EventTypeRow>(
    `SELECT e.* FROM event_types e
     JOIN users u ON u.id = e.owner_id
     WHERE u.username = $1 AND e.slug = $2`,
    [params.username, params.eventSlug]
  );
}

export async function createPrivateLink(
  eventTypeId: number,
  input: { expiresAt?: string | null; maxUsageCount?: number | null }
) {
  const row = await queryOne<PrivateLinkRow>(
    `INSERT INTO private_links (link_id, event_type_id, expires_at, max_usage_count)
     VALUES ($1, $2, $3, $4)
     RETURNING id, link_id, event_type_id, expires_at, max_usage_count, usage_count`,
    [
      randomBytes(12).toString("base64url"),
      eventTypeId,
      input.expiresAt ?? null,
      input.maxUsageCount ?? null,
    ]
  );
  return serializePrivateLink(row!, `${env.webOrigin}/d/${row!.link_id}`);
}

export async function listPrivateLinks(eventTypeId: number) {
  const rows = await query<PrivateLinkRow>(
    `SELECT id, link_id, event_type_id, expires_at, max_usage_count, usage_count
     FROM private_links WHERE event_type_id = $1 ORDER BY id`,
    [eventTypeId]
  );
  return rows.map((row) => serializePrivateLink(row, `${env.webOrigin}/d/${row.link_id}`));
}

export async function updatePrivateLink(
  eventTypeId: number,
  linkId: string,
  input: { expiresAt?: string | null; maxUsageCount?: number | null }
) {
  const row = await queryOne<PrivateLinkRow>(
    `UPDATE private_links SET
       expires_at = COALESCE($3, expires_at),
       max_usage_count = COALESCE($4, max_usage_count)
     WHERE event_type_id = $1 AND link_id = $2
     RETURNING id, link_id, event_type_id, expires_at, max_usage_count, usage_count`,
    [eventTypeId, linkId, input.expiresAt ?? null, input.maxUsageCount ?? null]
  );
  if (!row) throw notFound("Private link not found");
  return serializePrivateLink(row, `${env.webOrigin}/d/${row.link_id}`);
}

export async function deletePrivateLink(eventTypeId: number, linkId: string): Promise<void> {
  const row = await queryOne<{ id: number }>(
    "DELETE FROM private_links WHERE event_type_id = $1 AND link_id = $2 RETURNING id",
    [eventTypeId, linkId]
  );
  if (!row) throw notFound("Private link not found");
}
