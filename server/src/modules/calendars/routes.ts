// Linking a Google Calendar to the signed-in account.
//
// Linking is independent of how the user signed in: guest, OIDC or Google
// accounts can all connect a calendar as long as GOOGLE_CALENDAR_ENABLED is on.

import { Router } from "express";
import { badRequest } from "../../http/errors.ts";
import { handler, ok } from "../../http/respond.ts";
import { asObject, optBool, optStr, paramInt } from "../../http/validate.ts";
import { currentUser, requireAuth } from "../../auth/middleware.ts";
import { safeReturnTo, sealState } from "../../auth/google-flow.ts";
import {
  CALENDAR_SCOPES,
  LOGIN_SCOPES,
  assertGoogleCalendarEnabled,
  authorizeUrl,
  googleCalendarReady,
  listCalendars,
} from "../../lib/google.ts";
import { invalidateBusyCache } from "../../lib/calendar-sync.ts";
import {
  accessTokenFor,
  deleteConnection,
  findConnection,
  listConnections,
  serializeConnection,
  updateConnectionSettings,
} from "./repo.ts";

export const calendarsRouter: Router = Router();

calendarsRouter.use(requireAuth);

calendarsRouter.get(
  "/",
  handler(async (req, res) => {
    const connections = await listConnections(currentUser(req).id);
    ok(res, {
      googleEnabled: googleCalendarReady(),
      connections: connections.map(serializeConnection),
    });
  })
);

/** Returns the Google consent URL. The caller opens it as a top-level
 *  navigation; Google hands back to /v2/auth/google/callback. */
calendarsRouter.post(
  "/google/connect",
  handler(async (req, res) => {
    assertGoogleCalendarEnabled();
    const user = currentUser(req);
    const body = asObject(req.body ?? {});
    const returnTo = safeReturnTo(optStr(body, "returnTo"));
    const { token } = await sealState({ mode: "calendar", returnTo, userId: user.id });
    ok(res, {
      url: authorizeUrl({
        state: token,
        // The profile scopes are what let us label the connection with the
        // Google address it belongs to.
        scopes: [...LOGIN_SCOPES, ...CALENDAR_SCOPES],
        offline: true,
        loginHint: user.email,
      }),
    });
  })
);

/** The writable calendars in the connected account, for the destination picker. */
calendarsRouter.get(
  "/:id/calendars",
  handler(async (req, res) => {
    const user = currentUser(req);
    const connection = await findConnection(user.id, paramInt(req.params.id, "id"));
    if (!connection) throw badRequest("Calendar connection not found");
    const token = await accessTokenFor(connection);
    if (!token) throw badRequest("This calendar needs to be reconnected");
    const calendars = await listCalendars(token);
    ok(res, calendars.filter((entry) => entry.accessRole === "writer" || entry.accessRole === "owner"));
  })
);

calendarsRouter.patch(
  "/:id",
  handler(async (req, res) => {
    const user = currentUser(req);
    const body = asObject(req.body);
    const updated = await updateConnectionSettings(user.id, paramInt(req.params.id, "id"), {
      calendarId: optStr(body, "calendarId", { max: 300 }),
      calendarName: optStr(body, "calendarName", { max: 300 }) ?? null,
      syncBookings: optBool(body, "syncBookings"),
      checkConflicts: optBool(body, "checkConflicts"),
    });
    invalidateBusyCache();
    ok(res, serializeConnection(updated));
  })
);

calendarsRouter.delete(
  "/:id",
  handler(async (req, res) => {
    await deleteConnection(currentUser(req).id, paramInt(req.params.id, "id"));
    invalidateBusyCache();
    ok(res, { disconnected: true });
  })
);
