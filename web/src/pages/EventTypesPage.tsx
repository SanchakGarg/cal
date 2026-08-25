import { useEffect, useState } from "react";
import { Button, IconButton } from "../ui/Button.tsx";
import { CopyButton } from "../ui/CopyButton.tsx";
import { ConfirmDialog } from "../ui/Dialog.tsx";
import { Badge, EmptyState, List, ListRow, PageHeader, SkeletonList } from "../ui/Layout.tsx";
import { DropdownMenu, Popover } from "../ui/Popover.tsx";
import { Switch } from "../ui/Switch.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import { openExternal } from "../lib/url.ts";
import type { EventType, Team } from "../lib/types.ts";
import { durationLabel } from "../lib/time.ts";
import { useAuth } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";
import "./EventTypesPage.css";

export function EventTypesPage() {
  const { me } = useAuth();
  const { navigate } = useRouter();
  const toast = useToast();

  const [teams, setTeams] = useState<Team[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EventType | null>(null);

  const load = async (): Promise<void> => {
    setEventTypes(null);
    try {
      setEventTypes(await api.get<EventType[]>("/v2/event-types"));
    } catch (error) {
      toast.error(errorMessage(error));
      setEventTypes([]);
    }
  };

  useEffect(() => {
    void api.get<Team[]>("/v2/teams").then(setTeams).catch(() => setTeams([]));
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleHidden = async (eventType: EventType): Promise<void> => {
    try {
      const updated = await api.patch<EventType>(`/v2/event-types/${eventType.id}`, {
        hidden: !eventType.hidden,
      });
      setEventTypes((current) =>
        (current ?? []).map((item) => (item.id === updated.id ? updated : item))
      );
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const duplicate = async (eventType: EventType): Promise<void> => {
    try {
      const copy = await api.post<EventType>("/v2/event-types", {
        title: `${eventType.title} (copy)`,
        slug: `${eventType.slug}-copy`,
        lengthInMinutes: eventType.lengthInMinutes,
        description: eventType.description,
        // Carry the configuration over: a copy that loses its questions and
        // locations is not a copy.
        locations: eventType.locations,
        bookingFields: eventType.bookingFields,
        scheduleId: eventType.scheduleId ?? undefined,
        minimumBookingNotice: eventType.minimumBookingNotice,
        beforeEventBuffer: eventType.beforeEventBuffer,
        afterEventBuffer: eventType.afterEventBuffer,
        hidden: true,
      });
      toast.success("Event type duplicated", {
        description: "The copy is hidden until you publish it.",
        action: { label: "Open", onClick: () => navigate(`/event-types/${copy.id}`) },
      });
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const remove = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/v2/event-types/${deleteTarget.id}`);
      toast.success("Event type deleted");
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const publicBase = `${window.location.origin}`;
  const linkFor = (eventType: EventType): string =>
    `${publicBase}/${me?.username ?? ""}/${eventType.slug}`;

  return (
    <>
      <PageHeader
        title="Event Types"
        subtitle="Create events to share for people to book on your calendar."
        actions={
          <Button startIcon="plus" onClick={() => navigate("/event-types/new")}>
            New
          </Button>
        }
      />

      {teams.length > 0 ? (
        <div className="cal-event-types__teams">
          <span className="cal-hint">Team events live on the team:</span>
          {teams.map((team) => (
            <Button
              key={team.id}
              size="sm"
              variant="secondary"
              startIcon="users"
              onClick={() => navigate(`/teams/${team.id}/event-types`)}
            >
              {team.name}
            </Button>
          ))}
        </div>
      ) : null}

      {eventTypes === null ? (
        <SkeletonList rows={3} />
      ) : eventTypes.length === 0 ? (
        <EmptyState
          icon="link"
          title="Create your first event type"
          description="Event types let people book time with you based on your availability."
          action={
            <Button startIcon="plus" onClick={() => navigate("/event-types/new")}>
              New event type
            </Button>
          }
        />
      ) : (
        <List>
          {eventTypes.map((eventType) => (
            <ListRow key={eventType.id} onClick={() => navigate(`/event-types/${eventType.id}`)}>
              <div className="cal-event-type__text">
                <div className="cal-row">
                  <strong>{eventType.title}</strong>
                  {eventType.hidden ? <Badge startIcon="eyeOff">Hidden</Badge> : null}
                </div>
                <p className="cal-hint">
                  /{me?.username}/{eventType.slug}
                </p>
                {eventType.description ? <p className="cal-hint">{eventType.description}</p> : null}
                <div className="cal-row cal-event-type__badges">
                  <Badge startIcon="clock">{durationLabel(eventType.lengthInMinutes)}</Badge>
                  {eventType.recurrence && !eventType.recurrence.disabled ? (
                    <Badge startIcon="refresh">Recurring</Badge>
                  ) : null}
                  {eventType.seats && !eventType.seats.disabled ? (
                    <Badge startIcon="users">{eventType.seats.seatsPerTimeSlot} seats</Badge>
                  ) : null}
                </div>
              </div>

              <div className="cal-row" onClick={(event) => event.stopPropagation()}>
                <Switch
                  checked={!eventType.hidden}
                  onChange={() => void toggleHidden(eventType)}
                  size="sm"
                  label=""
                />
                <CopyButton value={linkFor(eventType)} />
                <IconButton
                  icon="external"
                  label="Preview"
                  variant="minimal"
                  size="sm"
                  onClick={() => openExternal(linkFor(eventType))}
                />
                <Popover
                  align="end"
                  width={180}
                  trigger={({ toggle, ref }) => (
                    <span ref={ref as (node: HTMLSpanElement | null) => void} onClick={toggle}>
                      <IconButton icon="dots" label="Event actions" variant="minimal" size="sm" />
                    </span>
                  )}
                >
                  {({ close }) => (
                    <DropdownMenu
                      close={close}
                      items={[
                        { label: "Edit", onSelect: () => navigate(`/event-types/${eventType.id}`) },
                        { label: "Duplicate", onSelect: () => void duplicate(eventType) },
                        { label: "Delete", destructive: true, onSelect: () => setDeleteTarget(eventType) },
                      ]}
                    />
                  )}
                </Popover>
              </div>
            </ListRow>
          ))}
        </List>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
        title="Delete event type"
        description={`"${deleteTarget?.title ?? ""}" and its booking link will stop working. Existing bookings are kept.`}
        confirmLabel="Delete"
        destructive
      />
    </>
  );
}
