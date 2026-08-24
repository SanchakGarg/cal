import { useEffect, useState } from "react";
import { Button, IconButton } from "../ui/Button.tsx";
import { CopyButton } from "../ui/CopyButton.tsx";
import { ConfirmDialog, Dialog } from "../ui/Dialog.tsx";
import { TextArea, TextField } from "../ui/Field.tsx";
import { Badge, EmptyState, List, ListRow, PageHeader, Skeleton, Tabs } from "../ui/Layout.tsx";
import { NumberField } from "../ui/Field.tsx";
import { DropdownMenu, Popover } from "../ui/Popover.tsx";
import { Switch } from "../ui/Switch.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { EventType, Team } from "../lib/types.ts";
import { durationLabel } from "../lib/time.ts";
import { useAuth } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";
import "./EventTypesPage.css";

const slugify = (value: string): string =>
  value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function EventTypesPage() {
  const { me } = useAuth();
  const { navigate, search } = useRouter();
  const toast = useToast();

  const [teams, setTeams] = useState<Team[]>([]);
  const [scope, setScope] = useState<string>(search.get("team") ?? "personal");
  const [eventTypes, setEventTypes] = useState<EventType[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState<number | "">(15);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EventType | null>(null);

  const load = async (): Promise<void> => {
    setEventTypes(null);
    try {
      const path = scope === "personal" ? "/v2/event-types" : `/v2/teams/${scope}/event-types`;
      setEventTypes(await api.get<EventType[]>(path));
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
  }, [scope]);

  const create = async (): Promise<void> => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        title,
        slug: slug || slugify(title),
        lengthInMinutes: duration === "" ? 15 : duration,
        description,
      };
      if (scope !== "personal") body.schedulingType = "collective";
      const path = scope === "personal" ? "/v2/event-types" : `/v2/teams/${scope}/event-types`;
      const created = await api.post<EventType>(path, body);
      setCreateOpen(false);
      setTitle("");
      setSlug("");
      setDescription("");
      navigate(`/event-types/${created.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const toggleHidden = async (eventType: EventType): Promise<void> => {
    try {
      const path =
        scope === "personal"
          ? `/v2/event-types/${eventType.id}`
          : `/v2/teams/${scope}/event-types/${eventType.id}`;
      const updated = await api.patch<EventType>(path, { hidden: !eventType.hidden });
      setEventTypes((current) =>
        (current ?? []).map((item) => (item.id === updated.id ? updated : item))
      );
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const duplicate = async (eventType: EventType): Promise<void> => {
    try {
      const path = scope === "personal" ? "/v2/event-types" : `/v2/teams/${scope}/event-types`;
      await api.post<EventType>(path, {
        title: `${eventType.title} (copy)`,
        slug: `${eventType.slug}-copy`,
        lengthInMinutes: eventType.lengthInMinutes,
        description: eventType.description,
        ...(scope === "personal" ? {} : { schedulingType: eventType.schedulingType ?? "collective" }),
      });
      toast.success("Event type duplicated");
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const remove = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      const path =
        scope === "personal"
          ? `/v2/event-types/${deleteTarget.id}`
          : `/v2/teams/${scope}/event-types/${deleteTarget.id}`;
      await api.delete(path);
      toast.success("Event type deleted");
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const publicBase = `${window.location.origin}`;
  const linkFor = (eventType: EventType): string => {
    if (eventType.teamId) {
      const team = teams.find((candidate) => candidate.id === eventType.teamId);
      return `${publicBase}/team/${team?.slug ?? eventType.teamId}/${eventType.slug}`;
    }
    return `${publicBase}/${me?.username ?? ""}/${eventType.slug}`;
  };

  return (
    <>
      <PageHeader
        title="Event Types"
        subtitle="Create events to share for people to book on your calendar."
        actions={
          <Button startIcon="plus" onClick={() => setCreateOpen(true)}>
            New
          </Button>
        }
      />

      {teams.length > 0 ? (
        <div className="cal-event-types__scope">
          <Tabs
            variant="pill"
            value={scope}
            onChange={(value) => setScope(value)}
            tabs={[
              { value: "personal", label: me?.name ?? "Personal" },
              ...teams.map((team) => ({ value: String(team.id), label: team.name })),
            ]}
          />
        </div>
      ) : null}

      {eventTypes === null ? (
        <List>
          {[0, 1].map((index) => (
            <ListRow key={index}>
              <Skeleton height={44} />
            </ListRow>
          ))}
        </List>
      ) : eventTypes.length === 0 ? (
        <EmptyState
          icon="link"
          title="Create your first event type"
          description="Event types let people book time with you based on your availability."
          action={
            <Button startIcon="plus" onClick={() => setCreateOpen(true)}>
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
                  {eventType.schedulingType ? (
                    <Badge tone="info">
                      {eventType.schedulingType === "roundRobin" ? "Round robin" : eventType.schedulingType}
                    </Badge>
                  ) : null}
                </div>
                <p className="cal-hint">
                  /{eventType.teamId ? "team" : me?.username}
                  {eventType.teamId ? `/${teams.find((team) => team.id === eventType.teamId)?.slug ?? ""}` : ""}/
                  {eventType.slug}
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
                  onClick={() => window.open(linkFor(eventType), "_blank")}
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

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add a new event type"
        description="Create an event type for people to book time with you."
        footer={
          <>
            <Button variant="minimal" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button loading={saving} disabled={!title.trim()} onClick={() => void create()}>
              Continue
            </Button>
          </>
        }
      >
        <TextField
          label="Title"
          placeholder="Quick Chat"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setSlug(slugify(event.target.value));
          }}
        />
        <TextField
          label="URL"
          prefix={`/${me?.username ?? ""}/`}
          value={slug}
          onChange={(event) => setSlug(slugify(event.target.value))}
        />
        <TextArea
          label="Description"
          placeholder="A quick video meeting."
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <NumberField label="Duration" suffix="minutes" min={1} value={duration} onValueChange={setDuration} />
      </Dialog>

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
