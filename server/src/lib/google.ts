// Google OAuth 2.0 and Calendar API v3, over plain fetch.
//
// The same OAuth client serves two flows that are configured separately:
//   * sign-in       — openid/email/profile, no offline access needed
//   * calendar link — calendar scopes with access_type=offline so we keep a
//                     refresh token and can write events long after the browser
//                     session is gone
// A single registered redirect URI handles both; the flow cookie says which.

import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../env.ts";
import { badRequest, forbidden } from "../http/errors.ts";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const REQUEST_TIMEOUT_MS = 10_000;

export const LOGIN_SCOPES = ["openid", "email", "profile"];
export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function credentialsPresent(): boolean {
  return Boolean(env.google.clientId && env.google.clientSecret);
}

export function googleLoginReady(): boolean {
  return env.google.loginEnabled && credentialsPresent();
}

export function googleCalendarReady(): boolean {
  return env.google.calendarEnabled && credentialsPresent();
}

export function assertGoogleLoginEnabled(): void {
  if (!env.google.loginEnabled) throw forbidden("Google sign-in is disabled");
  if (!credentialsPresent()) {
    throw forbidden("Google sign-in is enabled but GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are not set");
  }
}

export function assertGoogleCalendarEnabled(): void {
  if (!env.google.calendarEnabled) throw forbidden("Google Calendar is disabled");
  if (!credentialsPresent()) {
    throw forbidden(
      "Google Calendar is enabled but GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are not set"
    );
  }
}

export interface AuthorizeOptions {
  state: string;
  scopes: string[];
  /** Ask for a refresh token. Only the calendar flow needs one. */
  offline?: boolean;
  loginHint?: string;
}

export function authorizeUrl(options: AuthorizeOptions): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", env.google.clientId);
  url.searchParams.set("redirect_uri", env.google.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", options.scopes.join(" "));
  url.searchParams.set("state", options.state);
  url.searchParams.set("include_granted_scopes", "true");
  if (options.offline) {
    url.searchParams.set("access_type", "offline");
    // Google only re-issues a refresh token when consent is asked for again, so
    // a re-connect after a revoked grant would otherwise come back unusable.
    url.searchParams.set("prompt", "consent");
  }
  if (options.loginHint) url.searchParams.set("login_hint", options.loginHint);
  return url.toString();
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
  idToken: string | null;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenSet> {
  body.set("client_id", env.google.clientId);
  body.set("client_secret", env.google.clientSecret);
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !payload.access_token) {
    throw badRequest(
      `Google token request failed: ${payload.error_description ?? payload.error ?? response.status}`
    );
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000),
    scopes: payload.scope ? payload.scope.split(" ") : [],
    idToken: payload.id_token ?? null,
  };
}

export async function exchangeCode(code: string): Promise<TokenSet> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: env.google.redirectUri,
    })
  );
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const tokens = await tokenRequest(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken })
  );
  // A refresh response never repeats the refresh token; keep the one we hold.
  return { ...tokens, refreshToken };
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => undefined);
}

export interface GoogleProfile {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture?: string;
}

/** Reads the profile from the id_token when present, otherwise /userinfo. */
export async function profileFrom(tokens: TokenSet): Promise<GoogleProfile> {
  if (tokens.idToken) {
    if (!jwks) jwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
    const { payload } = await jwtVerify(tokens.idToken, jwks, {
      issuer: ISSUERS,
      audience: env.google.clientId,
    });
    const email = typeof payload.email === "string" ? payload.email : "";
    if (email) {
      return {
        subject: String(payload.sub),
        email,
        emailVerified: payload.email_verified === true,
        name: typeof payload.name === "string" ? payload.name : email.split("@")[0],
        picture: typeof payload.picture === "string" ? payload.picture : undefined,
      };
    }
  }

  const response = await fetch(USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${tokens.accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw badRequest("Could not read the Google account profile");
  const profile = (await response.json()) as Record<string, unknown>;
  const email = typeof profile.email === "string" ? profile.email : "";
  if (!email) throw badRequest("Google did not return an email address");
  return {
    subject: String(profile.sub ?? ""),
    email,
    emailVerified: profile.email_verified === true,
    name: typeof profile.name === "string" ? profile.name : email.split("@")[0],
    picture: typeof profile.picture === "string" ? profile.picture : undefined,
  };
}

export class GoogleApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
  }
}

async function calendarRequest<T>(
  accessToken: string,
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {}
): Promise<T> {
  const url = new URL(`${CALENDAR_API}${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  const response = await fetch(url.toString(), {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    // Slot generation calls freeBusy inline, so a hanging Google must not hang
    // a booking page.
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
  } & T;
  if (!response.ok) {
    throw new GoogleApiError(
      response.status,
      payload.error?.message ?? `Google Calendar request failed with ${response.status}`
    );
  }
  return payload;
}

export interface CalendarListEntry {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
}

export async function listCalendars(accessToken: string): Promise<CalendarListEntry[]> {
  const payload = await calendarRequest<{
    items?: Array<{ id: string; summary?: string; primary?: boolean; accessRole?: string }>;
  }>(accessToken, "/users/me/calendarList", { query: { minAccessRole: "writer", maxResults: "250" } });
  return (payload.items ?? []).map((item) => ({
    id: item.id,
    summary: item.summary ?? item.id,
    primary: item.primary === true,
    accessRole: item.accessRole ?? "reader",
  }));
}

export interface GoogleEventInput {
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  attendees?: Array<{ email: string; displayName?: string }>;
  /** Our booking uid, so a synced event can be traced back. */
  sourceUid?: string;
  createMeetLink?: boolean;
}

export interface GoogleEvent {
  id: string;
  htmlLink?: string;
  hangoutLink?: string;
  status?: string;
}

function eventBody(input: GoogleEventInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description ?? "",
    location: input.location || undefined,
    start: { dateTime: input.start.toISOString(), timeZone: "UTC" },
    end: { dateTime: input.end.toISOString(), timeZone: "UTC" },
    attendees: input.attendees?.map((attendee) => ({
      email: attendee.email,
      displayName: attendee.displayName,
    })),
    extendedProperties: input.sourceUid
      ? { private: { calBookingUid: input.sourceUid } }
      : undefined,
  };
  if (input.createMeetLink) {
    body.conferenceData = {
      createRequest: {
        // Must be unique per request; the booking uid is exactly that.
        requestId: input.sourceUid ?? `cal-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  return body;
}

export async function insertEvent(
  accessToken: string,
  calendarId: string,
  input: GoogleEventInput
): Promise<GoogleEvent> {
  return calendarRequest<GoogleEvent>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      body: eventBody(input),
      query: {
        sendUpdates: "none",
        conferenceDataVersion: input.createMeetLink ? "1" : undefined,
      },
    }
  );
}

export async function updateEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  input: GoogleEventInput
): Promise<GoogleEvent> {
  return calendarRequest<GoogleEvent>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PATCH", body: eventBody(input), query: { sendUpdates: "none" } }
  );
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  await calendarRequest<void>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", query: { sendUpdates: "none" } }
  );
}

export interface BusyInterval {
  start: number;
  end: number;
}

export async function freeBusy(
  accessToken: string,
  calendarIds: string[],
  from: Date,
  to: Date
): Promise<BusyInterval[]> {
  if (calendarIds.length === 0) return [];
  const payload = await calendarRequest<{
    calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
  }>(accessToken, "/freeBusy", {
    method: "POST",
    body: {
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      items: calendarIds.map((id) => ({ id })),
    },
  });
  const busy: BusyInterval[] = [];
  for (const calendar of Object.values(payload.calendars ?? {})) {
    for (const span of calendar.busy ?? []) {
      busy.push({ start: Date.parse(span.start), end: Date.parse(span.end) });
    }
  }
  return busy.filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end));
}
