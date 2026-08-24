import { useEffect, useMemo, useState } from "react";
import { PageHeader, Skeleton, Badge } from "../ui/Layout.tsx";
import { Select } from "../ui/Select.tsx";
import { Button } from "../ui/Button.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { EventType, SlotMap } from "../lib/types.ts";
import { addDaysISO, formatDateISO, formatTime, todayISO } from "../lib/time.ts";
import { useAuth, useTimeFormat } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";
import "./TroubleshootPage.css";

/** Shows the slots the API actually generates, day by day, for one event type. */
export function TroubleshootPage() {
  const { me } = useAuth();
  const { navigate } = useRouter();
  const timeFormat = useTimeFormat();
  const toast = useToast();

  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [eventTypeId, setEventTypeId] = useState<number | null>(null);
  const [weekStartISO, setWeekStartISO] = useState(() => todayISO(me?.timeZone ?? "UTC"));
  const [slots, setSlots] = useState<SlotMap | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void api
      .get<EventType[]>("/v2/event-types")
      .then((data) => {
        setEventTypes(data);
        setEventTypeId(data[0]?.id ?? null);
      })
      .catch((error) => toast.error(errorMessage(error)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_unused, index) => addDaysISO(weekStartISO, index)),
    [weekStartISO]
  );

  useEffect(() => {
    if (!eventTypeId) return;
    setLoading(true);
    const timeZone = me?.timeZone ?? "UTC";
    void api
      .get<SlotMap>("/v2/slots", {
        eventTypeId,
        start: `${weekStartISO}T00:00:00.000Z`,
        end: `${addDaysISO(weekStartISO, 7)}T00:00:00.000Z`,
        timeZone,
      })
      .then(setSlots)
      .catch((error) => toast.error(errorMessage(error)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventTypeId, weekStartISO]);

  const timeZone = me?.timeZone ?? "UTC";

  return (
    <>
      <PageHeader
        title="Troubleshoot"
        subtitle="See the exact slots your availability produces."
        onBack={() => navigate("/availability")}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setWeekStartISO(addDaysISO(weekStartISO, -7))}>
              Previous week
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setWeekStartISO(addDaysISO(weekStartISO, 7))}>
              Next week
            </Button>
          </>
        }
      />

      <div className="cal-troubleshoot__controls cal-card">
        <Select
          label="Event type"
          value={eventTypeId}
          options={eventTypes.map((eventType) => ({
            value: eventType.id,
            label: `${eventType.title} (${eventType.lengthInMinutes}m)`,
          }))}
          onChange={(value) => setEventTypeId(value)}
        />
        <p className="cal-hint">Times shown in {timeZone}</p>
      </div>

      <div className="cal-troubleshoot">
        {days.map((day) => {
          const daySlots = slots?.[day] ?? [];
          return (
            <div key={day} className="cal-troubleshoot__day cal-card">
              <div className="cal-troubleshoot__head">
                <strong>{formatDateISO(day, { weekday: "short", month: "short" })}</strong>
                {loading ? null : (
                  <Badge tone={daySlots.length ? "success" : "default"}>
                    {daySlots.length} slot{daySlots.length === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
              <div className="cal-troubleshoot__slots">
                {loading ? (
                  <Skeleton height={72} />
                ) : daySlots.length === 0 ? (
                  <p className="cal-hint">Unavailable</p>
                ) : (
                  daySlots.map((slot) => (
                    <span key={slot.start} className="cal-troubleshoot__slot">
                      {formatTime(new Date(slot.start), timeZone, timeFormat)}
                    </span>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
