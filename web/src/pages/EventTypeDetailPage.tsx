import { useEffect, useMemo, useState } from "react";
import { Button, IconButton } from "../ui/Button.tsx";
import { CopyButton } from "../ui/CopyButton.tsx";
import { Checkbox, NumberField, RadioGroup, TextArea, TextField } from "../ui/Field.tsx";
import { Badge, PageHeader, SettingsSection, Skeleton } from "../ui/Layout.tsx";
import { LocationPicker } from "../ui/LocationPicker.tsx";
import { QuestionBuilder } from "../ui/QuestionBuilder.tsx";
import { MultiSelect, Select } from "../ui/Select.tsx";
import { Switch } from "../ui/Switch.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";
import { Alert } from "../ui/Alert.tsx";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import { openExternal } from "../lib/url.ts";
import type { BookingField, EventType, EventTypeLocation, Membership, Schedule } from "../lib/types.ts";
import { useAuth } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";
import "./EventTypeDetailPage.css";

type TabKey = "setup" | "availability" | "limits" | "advanced" | "recurring" | "team";

const TAB_META: Array<{ value: TabKey; label: string; hint: string; icon: IconName }> = [
  { value: "setup", label: "Event Setup", hint: "Title, duration, location", icon: "link" },
  { value: "availability", label: "Availability", hint: "Which schedule applies", icon: "clock" },
  { value: "limits", label: "Limits", hint: "Buffers, notice, caps", icon: "ban" },
  { value: "advanced", label: "Advanced", hint: "Questions, seats, links", icon: "settings" },
  { value: "recurring", label: "Recurring", hint: "Repeat this event", icon: "refresh" },
  { value: "team", label: "Assignment", hint: "Hosts and scheduling", icon: "users" },
];

/** Mirrors the server's rule so the problem shows up before Save is pressed. */
function redirectError(value: string | null | undefined): string | undefined {
  const raw = (value ?? "").trim();
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "Only http and https links are allowed";
    }
  } catch {
    return "Enter a full URL, including https://";
  }
  return undefined;
}

function backTargetFor(teamId: number | null): string {
  return teamId ? `/teams/${teamId}/event-types` : "/event-types";
}

export function EventTypeDetailPage({
  eventTypeId,
  teamId,
}: {
  eventTypeId: number;
  teamId?: number;
}) {
  const { me } = useAuth();
  const { navigate, search } = useRouter();
  const toast = useToast();

  const [tab, setTab] = useState<TabKey>((search.get("tab") as TabKey) ?? "setup");
  const [eventType, setEventType] = useState<EventType | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [saving, setSaving] = useState(false);

  const owningTeamId = teamId ?? eventType?.teamId ?? null;
  const patchPath =
    owningTeamId != null
      ? `/v2/teams/${owningTeamId}/event-types/${eventTypeId}`
      : `/v2/event-types/${eventTypeId}`;

  useEffect(() => {
    void api
      .get<EventType>(`/v2/event-types/${eventTypeId}`)
      .then(async (data) => {
        setEventType(data);
        if (data.teamId) {
          const memberships = await api
            .get<Membership[]>(`/v2/teams/${data.teamId}/memberships`)
            .catch(() => []);
          setMembers(memberships.filter((membership) => membership.accepted));
        }
      })
      .catch((error) => toast.error(errorMessage(error)));
    void api.get<Schedule[]>("/v2/schedules").then(setSchedules).catch(() => setSchedules([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventTypeId]);

  const value = <T,>(key: string, current: T): T => (key in draft ? (draft[key] as T) : current);
  const set = (key: string, next: unknown): void => setDraft((current) => ({ ...current, [key]: next }));
  const dirty = Object.keys(draft).length > 0;

  const save = async (): Promise<void> => {
    if (!eventType) return;
    setSaving(true);
    try {
      const updated = await api.patch<EventType>(patchPath, draft);
      setEventType(updated);
      setDraft({});
      toast.success("Event type saved");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const leave = (): void => {
    if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    navigate(backTargetFor(owningTeamId));
  };

  const publicLink = useMemo(() => {
    if (!eventType) return "";
    const slug = String(value("slug", eventType.slug));
    if (eventType.bookingUrl) {
      const parsed = new URL(eventType.bookingUrl, window.location.origin);
      const segments = parsed.pathname.split("/").filter(Boolean);
      segments[segments.length - 1] = slug;
      return `${window.location.origin}/${segments.join("/")}`;
    }
    return `${window.location.origin}/${me?.username ?? ""}/${slug}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventType, draft, me]);

  if (!eventType) {
    return (
      <>
        <PageHeader title="Event type" />
        <Skeleton height={320} />
      </>
    );
  }

  const tabs = TAB_META.filter((entry) => entry.value !== "team" || eventType.teamId !== null);

  return (
    <>
      <PageHeader
        title={String(value("title", eventType.title))}
        subtitle={publicLink.replace(`${window.location.origin}`, "")}
        onBack={leave}
        actions={
          <>
            <Tooltip
              content={
                value("hidden", eventType.hidden)
                  ? "Hidden — the booking link still works but the event is not listed"
                  : "Visible on your public page"
              }
            >
              <span className="cal-row">
                <Switch
                  checked={!value("hidden", eventType.hidden)}
                  onChange={(checked) => set("hidden", !checked)}
                  size="sm"
                />
              </span>
            </Tooltip>
            <CopyButton value={publicLink} />
            <IconButton
              icon="external"
              label="Preview"
              variant="secondary"
              onClick={() => openExternal(publicLink)}
            />
            <Button loading={saving} disabled={!dirty} onClick={() => void save()}>
              Save
            </Button>
          </>
        }
      />

      <div className="cal-event-editor">
        <nav className="cal-event-editor__rail" aria-label="Event type sections">
          {tabs.map((entry) => (
            <button
              key={entry.value}
              type="button"
              className={`cal-event-editor__tab ${tab === entry.value ? "is-active" : ""}`}
              onClick={() => setTab(entry.value)}
            >
              <Icon name={entry.icon} size={15} />
              <span>
                <span className="cal-event-editor__tab-label">{entry.label}</span>
                <span className="cal-event-editor__tab-hint">{entry.hint}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="cal-event-editor__panel">
          {tab === "setup" ? (
            <SetupTab eventType={eventType} value={value} set={set} username={me?.username ?? ""} />
          ) : null}
          {tab === "availability" ? (
            <AvailabilityTab eventType={eventType} schedules={schedules} value={value} set={set} />
          ) : null}
          {tab === "limits" ? <LimitsTab eventType={eventType} value={value} set={set} /> : null}
          {tab === "advanced" ? (
            <AdvancedTab eventType={eventType} value={value} set={set} eventTypeId={eventTypeId} />
          ) : null}
          {tab === "recurring" ? <RecurringTab eventType={eventType} value={value} set={set} /> : null}
          {tab === "team" && eventType.teamId ? (
            <TeamTab eventType={eventType} members={members} value={value} set={set} />
          ) : null}
        </div>
      </div>

      {dirty ? (
        <div className="cal-unsaved-bar" role="status">
          <span>Unsaved changes</span>
          <div className="cal-row">
            <Button variant="minimal" onClick={() => setDraft({})}>
              Discard
            </Button>
            <Button loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

interface TabProps {
  eventType: EventType;
  value: <T>(key: string, current: T) => T;
  set: (key: string, next: unknown) => void;
}

function SetupTab({ eventType, value, set, username }: TabProps & { username: string }) {
  const durations = value<number[]>("lengthInMinutesOptions", eventType.lengthInMinutesOptions ?? []);

  return (
    <>
      <SettingsSection title="Basics" description="What people see before they book.">
        <TextField
          label="Title"
          value={value("title", eventType.title)}
          onChange={(event) => set("title", event.target.value)}
        />
        <TextField
          label="URL"
          prefix={eventType.teamId ? "/team/…/" : `/${username}/`}
          value={value("slug", eventType.slug)}
          onChange={(event) => set("slug", event.target.value)}
        />
        <TextArea
          label="Description"
          value={value("description", eventType.description)}
          onChange={(event) => set("description", event.target.value)}
        />
        <NumberField
          label="Duration"
          suffix="minutes"
          min={1}
          value={value("lengthInMinutes", eventType.lengthInMinutes)}
          onValueChange={(next) => set("lengthInMinutes", next === "" ? 15 : next)}
        />
        <MultiSelect
          label="Available durations"
          hint="Let the booker pick from several lengths."
          values={durations}
          options={[5, 10, 15, 20, 25, 30, 45, 50, 60, 75, 80, 90, 120, 180].map((minutes) => ({
            value: minutes,
            label: `${minutes} minutes`,
          }))}
          onChange={(next) => set("lengthInMinutesOptions", next)}
        />
      </SettingsSection>

      <SettingsSection title="Location" description="Where the meeting happens.">
        <LocationPicker
          locations={value<EventTypeLocation[]>("locations", eventType.locations)}
          onChange={(next) => set("locations", next)}
        />
      </SettingsSection>
    </>
  );
}

function AvailabilityTab({ eventType, schedules, value, set }: TabProps & { schedules: Schedule[] }) {
  const scheduleId = value<number | null>("scheduleId", eventType.scheduleId);
  const selected = schedules.find((schedule) => schedule.id === scheduleId);

  return (
    <SettingsSection
      title="Availability"
      description={
        eventType.teamId
          ? "Team events combine the hosts' own schedules. Pick a schedule here to make everyone follow the same hours instead."
          : "Which schedule decides when this event can be booked."
      }
    >
      <Select
        label="Schedule"
        value={scheduleId ?? 0}
        options={[
          { value: 0, label: eventType.teamId ? "Each host's own schedule" : "Default schedule" },
          ...schedules.map((schedule) => ({
            value: schedule.id,
            label: `${schedule.name}${schedule.isDefault ? " (default)" : ""}`,
            description: schedule.timeZone,
          })),
        ]}
        onChange={(next) => set("scheduleId", next === 0 ? null : next)}
      />
      {selected ? (
        <div className="cal-schedule-preview">
          {selected.availability.map((block, index) => (
            <div key={index} className="cal-schedule-preview__row">
              <span>{block.days.map((day) => day.slice(0, 3)).join(", ")}</span>
              <span className="cal-muted">
                {block.startTime} - {block.endTime}
              </span>
            </div>
          ))}
          <p className="cal-hint">Timezone: {selected.timeZone}</p>
          {selected.overrides.length > 0 ? (
            <p className="cal-hint">{selected.overrides.length} date override(s) applied</p>
          ) : null}
        </div>
      ) : null}
      <p className="cal-hint">
        Bookings made anywhere else — other event types, other teams — block these slots too, so a
        host is never double booked.
      </p>
    </SettingsSection>
  );
}

function LimitsTab({ eventType, value, set }: TabProps) {
  const countLimits = value("bookingLimitsCount", eventType.bookingLimitsCount) as
    | (Record<string, number> & { disabled?: boolean })
    | null;
  const durationLimits = value("bookingLimitsDuration", eventType.bookingLimitsDuration) as
    | (Record<string, number> & { disabled?: boolean })
    | null;
  const window_ = value("bookingWindow", eventType.bookingWindow) as
    | { type?: string; value?: number; rolling?: boolean; disabled?: boolean }
    | null;

  const countEnabled = Boolean(countLimits && !countLimits.disabled);
  const durationEnabled = Boolean(durationLimits && !durationLimits.disabled);
  const windowEnabled = Boolean(window_ && !window_.disabled && window_.type);

  const periodFields = (
    limits: Record<string, number> | null,
    onChange: (next: Record<string, number> | { disabled: true }) => void,
    suffix: string
  ) => (
    <div className="cal-limit-grid">
      {(["day", "week", "month", "year"] as const).map((period) => (
        <NumberField
          key={period}
          label={`Per ${period}`}
          suffix={suffix}
          min={1}
          value={limits?.[period] ?? ""}
          onValueChange={(next) => {
            const updated = { ...(limits ?? {}) };
            if (next === "") delete updated[period];
            else updated[period] = next;
            onChange(Object.keys(updated).length ? updated : { disabled: true });
          }}
        />
      ))}
    </div>
  );

  return (
    <>
      <SettingsSection title="Buffers and notice" description="Protect time around your meetings.">
        <div className="cal-limit-grid">
          <NumberField
            label="Before event"
            suffix="minutes"
            min={0}
            value={value("beforeEventBuffer", eventType.beforeEventBuffer)}
            onValueChange={(next) => set("beforeEventBuffer", next === "" ? 0 : next)}
          />
          <NumberField
            label="After event"
            suffix="minutes"
            min={0}
            value={value("afterEventBuffer", eventType.afterEventBuffer)}
            onValueChange={(next) => set("afterEventBuffer", next === "" ? 0 : next)}
          />
          <NumberField
            label="Minimum notice"
            suffix="minutes"
            min={0}
            value={value("minimumBookingNotice", eventType.minimumBookingNotice)}
            onValueChange={(next) => set("minimumBookingNotice", next === "" ? 0 : next)}
          />
          <NumberField
            label="Time-slot intervals"
            suffix="minutes"
            min={5}
            value={value("slotInterval", eventType.slotInterval) ?? ""}
            onValueChange={(next) => set("slotInterval", next === "" ? null : next)}
          />
          <NumberField
            label="Offset start times"
            suffix="minutes"
            min={0}
            value={value("offsetStart", eventType.offsetStart)}
            onValueChange={(next) => set("offsetStart", next === "" ? 0 : next)}
          />
        </div>
        <Switch
          checked={value("onlyShowFirstAvailableSlot", eventType.onlyShowFirstAvailableSlot)}
          onChange={(checked) => set("onlyShowFirstAvailableSlot", checked)}
          label="Only show the first slot of each day"
        />
      </SettingsSection>

      <SettingsSection title="Booking frequency" description="Cap how many bookings can be made.">
        <Switch
          checked={countEnabled}
          onChange={(checked) => set("bookingLimitsCount", checked ? { day: 5 } : { disabled: true })}
          label="Limit booking frequency"
        />
        {countEnabled ? periodFields(countLimits, (next) => set("bookingLimitsCount", next), "bookings") : null}
      </SettingsSection>

      <SettingsSection title="Total duration" description="Cap the total booked time per period.">
        <Switch
          checked={durationEnabled}
          onChange={(checked) => set("bookingLimitsDuration", checked ? { day: 120 } : { disabled: true })}
          label="Limit total booking duration"
        />
        {durationEnabled
          ? periodFields(durationLimits, (next) => set("bookingLimitsDuration", next), "minutes")
          : null}
      </SettingsSection>

      <SettingsSection title="Future bookings" description="How far ahead people can book.">
        <Switch
          checked={windowEnabled}
          onChange={(checked) =>
            set("bookingWindow", checked ? { type: "businessDays", value: 30, rolling: true } : { disabled: true })
          }
          label="Limit future bookings"
        />
        {windowEnabled ? (
          <div className="cal-limit-grid">
            <NumberField
              label="Days into the future"
              suffix="days"
              min={1}
              value={window_?.value ?? 30}
              onValueChange={(next) => set("bookingWindow", { ...window_, value: next === "" ? 1 : next })}
            />
            <Select
              label="Counting"
              value={window_?.type ?? "businessDays"}
              options={[
                { value: "businessDays", label: "Business days" },
                { value: "calendarDays", label: "Calendar days" },
              ]}
              onChange={(type) => set("bookingWindow", { ...window_, type })}
            />
          </div>
        ) : null}
      </SettingsSection>
    </>
  );
}

function AdvancedTab({ eventType, value, set, eventTypeId }: TabProps & { eventTypeId: number }) {
  const toast = useToast();
  const seats = value("seats", eventType.seats) as {
    seatsPerTimeSlot?: number;
    showAttendeeInfo?: boolean;
    showAvailabilityCount?: boolean;
    disabled?: boolean;
  };
  const confirmation = value("confirmationPolicy", eventType.confirmationPolicy) as
    | { type?: string; noticeThreshold?: { count: number; unit: string }; disabled?: boolean }
    | null;
  const seatsEnabled = Boolean(seats && !seats.disabled && seats.seatsPerTimeSlot);
  const confirmationEnabled = Boolean(confirmation && !confirmation.disabled && confirmation.type);

  const [links, setLinks] = useState<Array<{ linkId: string; bookingUrl: string | null; isExpired: boolean }>>([]);

  useEffect(() => {
    void api
      .get<Array<{ linkId: string; bookingUrl: string | null; isExpired: boolean }>>(
        `/v2/event-types/${eventTypeId}/private-links`
      )
      .then(setLinks)
      .catch(() => setLinks([]));
  }, [eventTypeId]);

  const addPrivateLink = async (): Promise<void> => {
    try {
      const created = await api.post<{ linkId: string; bookingUrl: string | null; isExpired: boolean }>(
        `/v2/event-types/${eventTypeId}/private-links`,
        {}
      );
      setLinks((current) => [...current, created]);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const removePrivateLink = async (linkId: string): Promise<void> => {
    try {
      await api.delete(`/v2/event-types/${eventTypeId}/private-links/${linkId}`);
      setLinks((current) => current.filter((link) => link.linkId !== linkId));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <>
      <SettingsSection
        title="Booking questions"
        description="Name and email are always asked. Add your own questions and reorder them."
      >
        <Alert tone="info" icon="info">
          Dropdowns, multiple choice, checkboxes, ratings, dates and times are all available. Answers
          are validated against the question when a booking comes in.
        </Alert>
        <QuestionBuilder
          fields={value<BookingField[]>("bookingFields", eventType.bookingFields)}
          onChange={(next) => set("bookingFields", next)}
        />
      </SettingsSection>

      <SettingsSection title="Confirmation" description="Approve bookings before they are accepted.">
        <Switch
          checked={confirmationEnabled}
          onChange={(checked) =>
            set(
              "confirmationPolicy",
              checked ? { type: "always", blockUnconfirmedBookingsInBooker: true } : { disabled: true }
            )
          }
          label="Requires confirmation"
        />
        {confirmationEnabled ? (
          <RadioGroup
            value={confirmation?.type === "time" ? "time" : "always"}
            onChange={(next) =>
              set(
                "confirmationPolicy",
                next === "always"
                  ? { type: "always", blockUnconfirmedBookingsInBooker: true }
                  : {
                      type: "time",
                      blockUnconfirmedBookingsInBooker: true,
                      noticeThreshold: { count: 30, unit: "minutes" },
                    }
              )
            }
            options={[
              { value: "always", label: "Always" },
              { value: "time", label: "When booked with less than 30 minutes notice" },
            ]}
          />
        ) : null}
        <Switch
          checked={value("requiresBookerEmailVerification", eventType.requiresBookerEmailVerification)}
          onChange={(checked) => set("requiresBookerEmailVerification", checked)}
          label="Requires booker email verification"
        />
      </SettingsSection>

      <SettingsSection title="Seats" description="Let several people book the same slot.">
        <Switch
          checked={seatsEnabled}
          onChange={(checked) =>
            set(
              "seats",
              checked
                ? { seatsPerTimeSlot: 5, showAttendeeInfo: false, showAvailabilityCount: true }
                : { disabled: true }
            )
          }
          label="Offer seats"
        />
        {seatsEnabled ? (
          <>
            <NumberField
              label="Seats per time slot"
              suffix="seats"
              min={1}
              value={seats.seatsPerTimeSlot ?? 5}
              onValueChange={(next) => set("seats", { ...seats, seatsPerTimeSlot: next === "" ? 1 : next })}
            />
            <Checkbox
              label="Share attendee information between guests"
              checked={seats.showAttendeeInfo ?? false}
              onChange={(event) => set("seats", { ...seats, showAttendeeInfo: event.target.checked })}
            />
            <Checkbox
              label="Show the number of available seats"
              checked={seats.showAvailabilityCount ?? true}
              onChange={(event) => set("seats", { ...seats, showAvailabilityCount: event.target.checked })}
            />
          </>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Other" description="Fine tuning for the booking page.">
        <TextField
          label="Event name in calendar"
          placeholder="{Event type title} between {Organiser} and {Scheduler}"
          value={value("customName", eventType.customName) ?? ""}
          onChange={(event) => set("customName", event.target.value)}
        />
        <TextField
          label="Redirect on booking"
          placeholder="https://example.com/thank-you"
          hint="Must be an absolute http(s) URL. Leave empty to show the confirmation page."
          error={redirectError(value("successRedirectUrl", eventType.successRedirectUrl))}
          value={value("successRedirectUrl", eventType.successRedirectUrl) ?? ""}
          onChange={(event) => set("successRedirectUrl", event.target.value)}
        />
        <Switch
          checked={value("disableGuests", eventType.disableGuests)}
          onChange={(checked) => set("disableGuests", checked)}
          label="Disable guests"
        />
        <Switch
          checked={value("lockTimeZoneToggleOnBookingPage", eventType.lockTimeZoneToggleOnBookingPage)}
          onChange={(checked) => set("lockTimeZoneToggleOnBookingPage", checked)}
          label="Lock timezone on booking page"
        />
        <Switch
          checked={value("disableCancelling", eventType.disableCancelling)}
          onChange={(checked) => set("disableCancelling", checked)}
          label="Disable cancelling"
        />
        <Switch
          checked={value("disableRescheduling", eventType.disableRescheduling)}
          onChange={(checked) => set("disableRescheduling", checked)}
          label="Disable rescheduling"
        />
      </SettingsSection>

      <SettingsSection title="Private links" description="Single-use or expiring booking links.">
        {links.length === 0 ? <p className="cal-hint">No private links yet.</p> : null}
        {links.map((link) => (
          <div key={link.linkId} className="cal-private-link">
            <code>{link.bookingUrl}</code>
            <div className="cal-row">
              {link.isExpired ? <Badge tone="error">Expired</Badge> : null}
              <CopyButton value={link.bookingUrl ?? ""} />
              <IconButton
                icon="trash"
                label="Delete link"
                variant="minimal"
                size="sm"
                onClick={() => void removePrivateLink(link.linkId)}
              />
            </div>
          </div>
        ))}
        <Button variant="secondary" size="sm" startIcon="plus" onClick={() => void addPrivateLink()}>
          Generate a private link
        </Button>
      </SettingsSection>
    </>
  );
}

function RecurringTab({ eventType, value, set }: TabProps) {
  const recurrence = value("recurrence", eventType.recurrence) as
    | { interval?: number; occurrences?: number; frequency?: string; disabled?: boolean }
    | null;
  const enabled = Boolean(recurrence && !recurrence.disabled && recurrence.frequency);

  return (
    <SettingsSection title="Recurring event" description="Repeat this meeting on a schedule.">
      <Switch
        checked={enabled}
        onChange={(checked) =>
          set("recurrence", checked ? { interval: 1, occurrences: 4, frequency: "weekly" } : { disabled: true })
        }
        label="Recurring event"
      />
      {enabled ? (
        <div className="cal-limit-grid">
          <NumberField
            label="Repeats every"
            suffix={recurrence?.frequency ?? "weekly"}
            min={1}
            value={recurrence?.interval ?? 1}
            onValueChange={(next) => set("recurrence", { ...recurrence, interval: next === "" ? 1 : next })}
          />
          <Select
            label="Frequency"
            value={recurrence?.frequency ?? "weekly"}
            options={[
              { value: "weekly", label: "Weekly" },
              { value: "monthly", label: "Monthly" },
              { value: "yearly", label: "Yearly" },
            ]}
            onChange={(frequency) => set("recurrence", { ...recurrence, frequency })}
          />
          <NumberField
            label="For a maximum of"
            suffix="events"
            min={1}
            value={recurrence?.occurrences ?? 4}
            onValueChange={(next) => set("recurrence", { ...recurrence, occurrences: next === "" ? 1 : next })}
          />
        </div>
      ) : null}
    </SettingsSection>
  );
}

function TeamTab({ eventType, members, value, set }: TabProps & { members: Membership[] }) {
  const schedulingType = value("schedulingType", eventType.schedulingType) as string | null;
  const hosts = value(
    "hosts",
    eventType.hosts.map((host) => ({
      userId: host.userId,
      mandatory: host.mandatory,
      priority: host.priority,
      weight: host.weight,
    }))
  ) as Array<{ userId: number; mandatory: boolean; priority: string; weight: number }>;
  const assignAll = value("assignAllTeamMembers", eventType.assignAllTeamMembers);

  return (
    <SettingsSection title="Assignment" description="Who hosts this event and how slots are chosen.">
      <RadioGroup
        label="Scheduling type"
        value={schedulingType ?? "collective"}
        onChange={(next) => set("schedulingType", next)}
        options={[
          {
            value: "collective",
            label: "Collective",
            description: "Everyone must be free — slots are the intersection of all hosts.",
          },
          {
            value: "roundRobin",
            label: "Round robin",
            description: "One host per booking, cycling through whoever is available.",
          },
          {
            value: "managed",
            label: "Managed",
            description: "Each member gets their own copy of this event type.",
          },
        ]}
      />

      <Switch
        checked={assignAll}
        onChange={(checked) => set("assignAllTeamMembers", checked)}
        label="Assign all team members"
        description="New members are added as hosts automatically."
      />

      {assignAll ? null : (
        <MultiSelect
          label="Hosts"
          hint="Slots come from these members' own availability."
          values={hosts.map((host) => host.userId)}
          options={members.map((membership) => ({
            value: membership.userId,
            label: membership.user?.name || membership.user?.email || `User ${membership.userId}`,
          }))}
          onChange={(userIds) =>
            set(
              "hosts",
              userIds.map((userId) => {
                const existing = hosts.find((host) => host.userId === userId);
                return (
                  existing ?? {
                    userId,
                    mandatory: schedulingType === "collective",
                    priority: "medium",
                    weight: 100,
                  }
                );
              })
            )
          }
        />
      )}

      {!assignAll && schedulingType === "roundRobin" && hosts.length > 0 ? (
        <div className="cal-host-list">
          <p className="cal-hint">
            Higher priority hosts are offered first; weight breaks ties when several are free.
          </p>
          {hosts.map((host, index) => {
            const membership = members.find((candidate) => candidate.userId === host.userId);
            return (
              <div key={host.userId} className="cal-host-row">
                <span>{membership?.user?.name ?? `User ${host.userId}`}</span>
                <Select
                  size="sm"
                  value={host.priority}
                  options={["lowest", "low", "medium", "high", "highest"].map((priority) => ({
                    value: priority,
                    label: priority,
                  }))}
                  onChange={(priority) =>
                    set(
                      "hosts",
                      hosts.map((item, itemIndex) => (itemIndex === index ? { ...item, priority } : item))
                    )
                  }
                />
                <NumberField
                  suffix="weight"
                  min={0}
                  value={host.weight}
                  onValueChange={(weight) =>
                    set(
                      "hosts",
                      hosts.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, weight: weight === "" ? 100 : weight } : item
                      )
                    )
                  }
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </SettingsSection>
  );
}
