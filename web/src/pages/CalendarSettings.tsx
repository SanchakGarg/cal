// Google Calendar linking. Deliberately reachable no matter how the user signed
// in — connecting a calendar is a separate grant from Google sign-in, so this
// page works with guest and OIDC accounts too.

import { useEffect, useState } from "react";
import { Button, IconButton } from "../ui/Button.tsx";
import { Alert } from "../ui/Alert.tsx";
import { Badge, List, ListRow, SettingsSection } from "../ui/Layout.tsx";
import { GoogleMark } from "../ui/GoogleMark.tsx";
import { Select } from "../ui/Select.tsx";
import { Switch } from "../ui/Switch.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { CalendarConnection, GoogleCalendarOption } from "../lib/types.ts";
import { useRouter } from "../app/router.tsx";

interface ConnectionsResponse {
  googleEnabled: boolean;
  connections: CalendarConnection[];
}

export function CalendarSettings() {
  const toast = useToast();
  const { search, navigate } = useRouter();
  const [state, setState] = useState<ConnectionsResponse | null>(null);
  const [connecting, setConnecting] = useState(false);

  const load = async (): Promise<void> => {
    try {
      setState(await api.get<ConnectionsResponse>("/v2/calendars"));
    } catch (error) {
      toast.error(errorMessage(error));
      setState({ googleEnabled: false, connections: [] });
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The OAuth hand-back lands here with ?calendar=connected.
  useEffect(() => {
    if (search.get("calendar") !== "connected") return;
    toast.success("Google Calendar connected");
    navigate("/settings/calendars", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const connect = async (): Promise<void> => {
    setConnecting(true);
    try {
      const { url } = await api.post<{ url: string }>("/v2/calendars/google/connect", {
        returnTo: `${window.location.origin}/settings/calendars`,
      });
      window.location.href = url;
    } catch (error) {
      toast.error(errorMessage(error));
      setConnecting(false);
    }
  };

  return (
    <SettingsSection
      title="Calendars"
      description="Link a Google Calendar so confirmed bookings land on it automatically and your existing events block your availability."
      footer={
        state?.googleEnabled ? (
          <Button loading={connecting} onClick={() => void connect()}>
            {state.connections.length > 0 ? "Connect another account" : "Connect Google Calendar"}
          </Button>
        ) : null
      }
    >
      {state === null ? <p className="cal-hint">Loading…</p> : null}

      {state && !state.googleEnabled ? (
        <Alert tone="info" title="Google Calendar is not configured">
          Set <code>GOOGLE_CALENDAR_ENABLED=true</code> along with{" "}
          <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in the API
          environment to turn this on.
        </Alert>
      ) : null}

      {state?.googleEnabled && state.connections.length === 0 ? (
        <p className="cal-hint">No calendar connected yet.</p>
      ) : null}

      {state && state.connections.length > 0 ? (
        <List>
          {state.connections.map((connection) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              onChanged={() => void load()}
            />
          ))}
        </List>
      ) : null}
    </SettingsSection>
  );
}

function ConnectionRow({
  connection,
  onChanged,
}: {
  connection: CalendarConnection;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [calendars, setCalendars] = useState<GoogleCalendarOption[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (connection.needsReconnect) return;
    void api
      .get<GoogleCalendarOption[]>(`/v2/calendars/${connection.id}/calendars`)
      .then(setCalendars)
      .catch(() => setCalendars([]));
  }, [connection.id, connection.needsReconnect]);

  const patch = async (body: Record<string, unknown>, message: string): Promise<void> => {
    setBusy(true);
    try {
      await api.patch(`/v2/calendars/${connection.id}`, body);
      toast.success(message);
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.delete(`/v2/calendars/${connection.id}`);
      toast.success("Calendar disconnected");
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ListRow>
      <div style={{ display: "grid", gap: 12, flex: 1 }}>
        <div className="cal-row" style={{ gap: 10, alignItems: "center" }}>
          <GoogleMark size={18} />
          <strong>{connection.email}</strong>
          {connection.needsReconnect ? <Badge tone="error">Reconnect needed</Badge> : null}
        </div>

        {connection.needsReconnect ? (
          <p className="cal-hint">
            {connection.lastError ?? "Google refused the stored grant."} Connect the account
            again to resume syncing.
          </p>
        ) : (
          <>
            <Select
              label="Add bookings to"
              value={connection.calendarId}
              disabled={busy || calendars === null}
              options={
                calendars && calendars.length > 0
                  ? calendars.map((calendar) => ({
                      value: calendar.id,
                      label: calendar.primary ? `${calendar.summary} (primary)` : calendar.summary,
                    }))
                  : [{ value: connection.calendarId, label: connection.calendarName ?? "Primary calendar" }]
              }
              onChange={(next) => {
                const chosen = calendars?.find((calendar) => calendar.id === next);
                void patch(
                  { calendarId: next, calendarName: chosen?.summary ?? null },
                  "Destination calendar updated"
                );
              }}
            />
            <Switch
              checked={connection.syncBookings}
              disabled={busy}
              label="Add confirmed bookings to this calendar"
              description="Cancelling or rescheduling updates the Google event too."
              onChange={(next) =>
                void patch({ syncBookings: next }, next ? "Sync on" : "Sync off")
              }
            />
            <Switch
              checked={connection.checkConflicts}
              disabled={busy}
              label="Block my availability with events from this calendar"
              description="Busy time in Google hides matching slots on your booking pages."
              onChange={(next) =>
                void patch({ checkConflicts: next }, next ? "Conflict checking on" : "Conflict checking off")
              }
            />
          </>
        )}
      </div>

      <IconButton
        icon="trash"
        label="Disconnect calendar"
        variant="minimal"
        size="sm"
        disabled={busy}
        onClick={() => void disconnect()}
      />
    </ListRow>
  );
}
