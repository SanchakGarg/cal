// Stored Google Calendar grants: reading them back, keeping the access token
// fresh, and marking a grant dead when Google stops honouring the refresh token.

import { query, queryOne } from "../../db/pool.ts";
import { badRequest } from "../../http/errors.ts";
import { refreshAccessToken, revokeToken } from "../../lib/google.ts";

export interface CalendarConnectionRow {
  id: number;
  user_id: number;
  provider: string;
  account_email: string;
  account_subject: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: Date | null;
  scopes: string[];
  calendar_id: string;
  calendar_name: string | null;
  sync_bookings: boolean;
  check_conflicts: boolean;
  invalid_since: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `id, user_id, provider, account_email, account_subject, access_token, refresh_token,
                 token_expires_at, scopes, calendar_id, calendar_name, sync_bookings, check_conflicts,
                 invalid_since, last_error, created_at, updated_at`;

export function serializeConnection(row: CalendarConnectionRow) {
  return {
    id: row.id,
    provider: row.provider,
    email: row.account_email,
    calendarId: row.calendar_id,
    calendarName: row.calendar_name,
    syncBookings: row.sync_bookings,
    checkConflicts: row.check_conflicts,
    /** True once a token refresh has failed — the user must re-connect. */
    needsReconnect: row.invalid_since !== null,
    lastError: row.last_error,
    connectedAt: row.created_at.toISOString(),
  };
}

export async function listConnections(userId: number): Promise<CalendarConnectionRow[]> {
  return query<CalendarConnectionRow>(
    `SELECT ${COLUMNS} FROM calendar_connections WHERE user_id = $1 ORDER BY id`,
    [userId]
  );
}

export async function findConnection(
  userId: number,
  id: number
): Promise<CalendarConnectionRow | null> {
  return queryOne<CalendarConnectionRow>(
    `SELECT ${COLUMNS} FROM calendar_connections WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
}

/** Connections for these users that should have bookings written to them. */
export async function connectionsForSync(userIds: number[]): Promise<CalendarConnectionRow[]> {
  if (userIds.length === 0) return [];
  return query<CalendarConnectionRow>(
    `SELECT ${COLUMNS} FROM calendar_connections
     WHERE user_id = ANY($1::int[]) AND sync_bookings = TRUE AND invalid_since IS NULL`,
    [userIds]
  );
}

/** Connections whose external busy time should block slots. */
export async function connectionsForConflicts(userIds: number[]): Promise<CalendarConnectionRow[]> {
  if (userIds.length === 0) return [];
  return query<CalendarConnectionRow>(
    `SELECT ${COLUMNS} FROM calendar_connections
     WHERE user_id = ANY($1::int[]) AND check_conflicts = TRUE AND invalid_since IS NULL`,
    [userIds]
  );
}

export interface UpsertConnectionInput {
  userId: number;
  email: string;
  subject: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
}

/** Re-connecting the same Google account updates the grant in place, so the
 *  synced-event rows that point at it survive. */
export async function upsertConnection(
  input: UpsertConnectionInput
): Promise<CalendarConnectionRow> {
  const rows = await query<CalendarConnectionRow>(
    `INSERT INTO calendar_connections
       (user_id, provider, account_email, account_subject, access_token, refresh_token,
        token_expires_at, scopes)
     VALUES ($1, 'google', $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, provider, account_email) DO UPDATE SET
       account_subject  = EXCLUDED.account_subject,
       access_token     = EXCLUDED.access_token,
       -- Google omits the refresh token on a re-consent it considers redundant.
       refresh_token    = COALESCE(EXCLUDED.refresh_token, calendar_connections.refresh_token),
       token_expires_at = EXCLUDED.token_expires_at,
       scopes           = EXCLUDED.scopes,
       invalid_since    = NULL,
       last_error       = NULL,
       updated_at       = now()
     RETURNING ${COLUMNS}`,
    [
      input.userId,
      input.email,
      input.subject,
      input.accessToken,
      input.refreshToken,
      input.expiresAt,
      input.scopes,
    ]
  );
  return rows[0];
}

export async function updateConnectionSettings(
  userId: number,
  id: number,
  patch: {
    calendarId?: string;
    calendarName?: string | null;
    syncBookings?: boolean;
    checkConflicts?: boolean;
  }
): Promise<CalendarConnectionRow> {
  const rows = await query<CalendarConnectionRow>(
    `UPDATE calendar_connections SET
       calendar_id     = COALESCE($3, calendar_id),
       calendar_name   = CASE WHEN $3::text IS NULL THEN calendar_name ELSE $4::text END,
       sync_bookings   = COALESCE($5, sync_bookings),
       check_conflicts = COALESCE($6, check_conflicts),
       updated_at      = now()
     WHERE id = $1 AND user_id = $2
     RETURNING ${COLUMNS}`,
    [
      id,
      userId,
      patch.calendarId ?? null,
      patch.calendarName ?? null,
      patch.syncBookings ?? null,
      patch.checkConflicts ?? null,
    ]
  );
  if (!rows[0]) throw badRequest("Calendar connection not found");
  return rows[0];
}

export async function deleteConnection(userId: number, id: number): Promise<void> {
  const row = await findConnection(userId, id);
  if (!row) throw badRequest("Calendar connection not found");
  // Revoking is per Google account, not per row: if another user here has the
  // same Google account linked, revoking would silently break their sync too.
  const sharedElsewhere = row.account_subject
    ? await queryOne(
        `SELECT 1 FROM calendar_connections
         WHERE id <> $1 AND provider = 'google' AND account_subject = $2`,
        [id, row.account_subject]
      )
    : null;
  if (row.refresh_token && !sharedElsewhere) await revokeToken(row.refresh_token);

  await query("DELETE FROM calendar_connections WHERE id = $1 AND user_id = $2", [id, userId]);
}

async function markInvalid(id: number, message: string): Promise<void> {
  await query(
    "UPDATE calendar_connections SET invalid_since = now(), last_error = $2, updated_at = now() WHERE id = $1",
    [id, message.slice(0, 500)]
  );
}

/** A token good for at least the next minute, refreshing when it is not.
 *  Returns null (and flags the row) when the grant can no longer be renewed. */
export async function accessTokenFor(
  connection: CalendarConnectionRow
): Promise<string | null> {
  const stillValid =
    connection.access_token &&
    connection.token_expires_at &&
    connection.token_expires_at.getTime() - Date.now() > 60_000;
  if (stillValid) return connection.access_token;

  if (!connection.refresh_token) {
    await markInvalid(connection.id, "No refresh token stored — reconnect the calendar");
    return null;
  }
  try {
    const tokens = await refreshAccessToken(connection.refresh_token);
    await query(
      `UPDATE calendar_connections
       SET access_token = $2, token_expires_at = $3, invalid_since = NULL, last_error = NULL,
           updated_at = now()
       WHERE id = $1`,
      [connection.id, tokens.accessToken, tokens.expiresAt]
    );
    connection.access_token = tokens.accessToken;
    connection.token_expires_at = tokens.expiresAt;
    return tokens.accessToken;
  } catch (error) {
    await markInvalid(connection.id, (error as Error).message);
    return null;
  }
}
