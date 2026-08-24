// Everything for one team lives here: dashboard, event types, members, availability.
// Navigating between these tabs never leaves the team context.
import { useEffect, useMemo, useState } from "react";
import { Button, IconButton } from "../ui/Button.tsx";
import { CopyButton } from "../ui/CopyButton.tsx";
import { ConfirmDialog, Dialog } from "../ui/Dialog.tsx";
import { NumberField, TextArea, TextField } from "../ui/Field.tsx";
import {
  Avatar,
  AvatarGroup,
  Badge,
  EmptyState,
  List,
  ListRow,
  PageHeader,
  Skeleton,
  Tabs,
} from "../ui/Layout.tsx";
import { locationLabel } from "../ui/LocationPicker.tsx";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { DropdownMenu, Popover } from "../ui/Popover.tsx";
import { RadioGroup } from "../ui/Field.tsx";
import { Select } from "../ui/Select.tsx";
import { Switch } from "../ui/Switch.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { Booking, EventType, Membership, Schedule, Team } from "../lib/types.ts";
import { availabilitySummary, durationLabel, formatDateTime, formatTime } from "../lib/time.ts";
import { useAuth, useTimeFormat } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";
import "./TeamPage.css";

export type TeamTab = "dashboard" | "event-types" | "members" | "availability";

const TABS: Array<{ value: TeamTab; label: string }> = [
  { value: "dashboard", label: "Dashboard" },
  { value: "event-types", label: "Event types" },
  { value: "members", label: "Members" },
  { value: "availability", label: "Availability" },
];

const ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
const slugify = (value: string): string =>
  value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function TeamPage({ teamId, tab }: { teamId: number; tab: TeamTab }) {
  const { navigate } = useRouter();
  const toast = useToast();

  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<Membership[] | null>(null);
  const [eventTypes, setEventTypes] = useState<EventType[] | null>(null);
  const [bookings, setBookings] = useState<Booking[] | null>(null);

  const load = async (): Promise<void> => {
    try {
      const [teamData, membershipData, eventTypeData] = await Promise.all([
        api.get<Team>(`/v2/teams/${teamId}`),
        api.get<Membership[]>(`/v2/teams/${teamId}/memberships`),
        api.get<EventType[]>(`/v2/teams/${teamId}/event-types`),
      ]);
      setTeam(teamData);
      setMembers(membershipData);
      setEventTypes(eventTypeData);
      setBookings(await api.get<Booking[]>(`/v2/teams/${teamId}/bookings`).catch(() => []));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  return (
    <>
      <PageHeader
        title={team?.name ?? "Team"}
        subtitle={team?.slug ? `/team/${team.slug}` : undefined}
        onBack={() => navigate("/teams")}
        actions={
          team?.slug ? (
            <>
              <CopyButton value={`${window.location.origin}/team/${team.slug}`} label="Copy team page link" />
              <IconButton
                icon="external"
                label="Open team page"
                variant="secondary"
                onClick={() => window.open(`/team/${team.slug}`, "_blank")}
              />
            </>
          ) : undefined
        }
      />

      <Tabs tabs={TABS} value={tab} onChange={(next) => navigate(`/teams/${teamId}/${next}`)} />

      <div className="cal-team">
        {tab === "dashboard" ? (
          <TeamDashboard
            teamId={teamId}
            members={members}
            eventTypes={eventTypes}
            bookings={bookings}
            onReload={load}
          />
        ) : null}
        {tab === "event-types" ? (
          <TeamEventTypes teamId={teamId} members={members ?? []} eventTypes={eventTypes} onReload={load} />
        ) : null}
        {tab === "members" ? (
          <TeamMembers teamId={teamId} members={members} onReload={load} />
        ) : null}
        {tab === "availability" ? <TeamAvailability teamId={teamId} members={members ?? []} /> : null}
      </div>
    </>
  );
}

function TeamDashboard({
  teamId,
  members,
  eventTypes,
  bookings,
  onReload,
}: {
  teamId: number;
  members: Membership[] | null;
  eventTypes: EventType[] | null;
  bookings: Booking[] | null;
  onReload: () => Promise<void>;
}) {
  const { me } = useAuth();
  const timeFormat = useTimeFormat();
  const { navigate } = useRouter();
  const toast = useToast();
  const timeZone = me?.timeZone ?? "UTC";
  const now = Date.now();

  const upcoming = useMemo(
    () =>
      (bookings ?? [])
        .filter((booking) => booking.status !== "cancelled" && booking.status !== "rejected")
        .filter((booking) => new Date(booking.end).getTime() >= now)
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
    [bookings, now]
  );

  const stats = useMemo(() => {
    const weekEnd = now + 7 * 86400000;
    const thisWeek = upcoming.filter((booking) => new Date(booking.start).getTime() <= weekEnd);
    const pending = (bookings ?? []).filter((booking) => booking.status === "pending");
    const perHost = new Map<string, number>();
    for (const booking of upcoming) {
      for (const host of booking.hosts) {
        perHost.set(host.name || host.email, (perHost.get(host.name || host.email) ?? 0) + 1);
      }
    }
    return { thisWeek: thisWeek.length, pending: pending.length, perHost };
  }, [bookings, upcoming, now]);

  const confirm = async (booking: Booking, action: "confirm" | "decline"): Promise<void> => {
    try {
      await api.post(`/v2/bookings/${booking.uid}/${action}`);
      toast.success(action === "confirm" ? "Booking confirmed" : "Booking declined");
      await onReload();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (!bookings || !members || !eventTypes) {
    return <Skeleton height={260} />;
  }

  return (
    <div className="cal-stack">
      <div className="cal-team__stats">
        <StatCard label="Upcoming bookings" value={upcoming.length} icon="calendar" />
        <StatCard label="Next 7 days" value={stats.thisWeek} icon="clock" />
        <StatCard label="Awaiting confirmation" value={stats.pending} icon="alert" />
        <StatCard label="Members" value={members.filter((m) => m.accepted).length} icon="users" />
        <StatCard label="Event types" value={eventTypes.length} icon="link" />
      </div>

      <section className="cal-card cal-team__panel">
        <div className="cal-team__panel-head">
          <div>
            <h2>Upcoming bookings</h2>
            <p className="cal-hint">Who is taking each meeting, and when.</p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => navigate(`/teams/${teamId}/event-types`)}
          >
            Team event types
          </Button>
        </div>

        {upcoming.length === 0 ? (
          <EmptyState
            icon="calendar"
            title="No upcoming team bookings"
            description="Bookings made through this team's event links appear here."
          />
        ) : (
          <List>
            {upcoming.slice(0, 12).map((booking) => {
              const attendee = booking.attendees[0];
              return (
                <ListRow key={booking.uid}>
                  <div className="cal-team__when">
                    <strong>{formatDateTime(new Date(booking.start), timeZone, timeFormat)}</strong>
                    <span className="cal-hint">
                      {formatTime(new Date(booking.start), timeZone, timeFormat)} –{" "}
                      {formatTime(new Date(booking.end), timeZone, timeFormat)} · {booking.duration}m
                    </span>
                  </div>

                  <div className="cal-team__what">
                    <div className="cal-row">
                      <strong>{booking.eventType?.title ?? booking.title}</strong>
                      {booking.status === "pending" ? <Badge tone="attention">Unconfirmed</Badge> : null}
                    </div>
                    <div className="cal-row">
                      <AvatarGroup people={booking.hosts.map((host) => ({ name: host.name }))} size={20} />
                      <span className="cal-hint">
                        {booking.hosts.map((host) => host.name).join(", ") || "Unassigned"}
                        {attendee ? ` · with ${attendee.name} (${attendee.email})` : ""}
                      </span>
                    </div>
                    {booking.location ? <p className="cal-hint">{booking.location}</p> : null}
                  </div>

                  <div className="cal-row">
                    {booking.status === "pending" ? (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => void confirm(booking, "decline")}>
                          Reject
                        </Button>
                        <Button size="sm" onClick={() => void confirm(booking, "confirm")}>
                          Confirm
                        </Button>
                      </>
                    ) : null}
                    <IconButton
                      icon="external"
                      label="Open booking"
                      variant="minimal"
                      size="sm"
                      onClick={() => navigate(`/booking/${booking.uid}`)}
                    />
                  </div>
                </ListRow>
              );
            })}
          </List>
        )}
      </section>

      <section className="cal-card cal-team__panel">
        <div className="cal-team__panel-head">
          <div>
            <h2>Load per host</h2>
            <p className="cal-hint">Upcoming bookings assigned to each member.</p>
          </div>
        </div>
        {stats.perHost.size === 0 ? (
          <p className="cal-hint">Nothing assigned yet.</p>
        ) : (
          <div className="cal-team__load">
            {[...stats.perHost.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([name, count]) => {
                const max = Math.max(...stats.perHost.values());
                return (
                  <div key={name} className="cal-team__load-row">
                    <Avatar name={name} size={22} />
                    <span className="cal-team__load-name">{name}</span>
                    <span className="cal-team__load-bar">
                      <span style={{ width: `${(count / max) * 100}%` }} />
                    </span>
                    <span className="cal-hint">{count}</span>
                  </div>
                );
              })}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: IconName }) {
  return (
    <div className="cal-card cal-stat">
      <span className="cal-stat__icon">
        <Icon name={icon} size={15} />
      </span>
      <span className="cal-stat__value">{value}</span>
      <span className="cal-stat__label">{label}</span>
    </div>
  );
}

function TeamEventTypes({
  teamId,
  members,
  eventTypes,
  onReload,
}: {
  teamId: number;
  members: Membership[];
  eventTypes: EventType[] | null;
  onReload: () => Promise<void>;
}) {
  const { navigate } = useRouter();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState<number | "">(30);
  const [schedulingType, setSchedulingType] = useState<"collective" | "roundRobin" | "managed">("collective");
  const [hostIds, setHostIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EventType | null>(null);

  const accepted = members.filter((membership) => membership.accepted);

  const create = async (): Promise<void> => {
    setSaving(true);
    try {
      const created = await api.post<EventType>(`/v2/teams/${teamId}/event-types`, {
        title,
        slug: slug || slugify(title),
        description,
        lengthInMinutes: duration === "" ? 30 : duration,
        schedulingType,
        hosts: (hostIds.length ? hostIds : accepted.map((membership) => membership.userId)).map((userId) => ({
          userId,
          mandatory: schedulingType === "collective",
        })),
      });
      setCreateOpen(false);
      setTitle("");
      setSlug("");
      setDescription("");
      setHostIds([]);
      navigate(`/teams/${teamId}/event-types/${created.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const toggleHidden = async (eventType: EventType): Promise<void> => {
    try {
      await api.patch(`/v2/teams/${teamId}/event-types/${eventType.id}`, { hidden: !eventType.hidden });
      await onReload();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const remove = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/v2/teams/${teamId}/event-types/${deleteTarget.id}`);
      setDeleteTarget(null);
      await onReload();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (!eventTypes) return <Skeleton height={180} />;

  return (
    <div className="cal-stack">
      <div className="cal-row">
        <p className="cal-hint">
          Slots for these events come from the assigned members' own availability, and any booking
          they take elsewhere blocks them here too.
        </p>
        <div className="cal-spacer" />
        <Button startIcon="plus" onClick={() => setCreateOpen(true)}>
          New team event
        </Button>
      </div>

      {eventTypes.length === 0 ? (
        <EmptyState
          icon="link"
          title="No team event types yet"
          description="Create one and pick who hosts it — collectively or round robin."
          action={
            <Button startIcon="plus" onClick={() => setCreateOpen(true)}>
              New team event
            </Button>
          }
        />
      ) : (
        <List>
          {eventTypes.map((eventType) => (
            <ListRow
              key={eventType.id}
              onClick={() => navigate(`/teams/${teamId}/event-types/${eventType.id}`)}
            >
              <div className="cal-team__what">
                <div className="cal-row">
                  <strong>{eventType.title}</strong>
                  {eventType.hidden ? <Badge startIcon="eyeOff">Hidden</Badge> : null}
                  <Badge tone="info">
                    {eventType.schedulingType === "roundRobin"
                      ? "Round robin"
                      : eventType.schedulingType === "managed"
                        ? "Managed"
                        : "Collective"}
                  </Badge>
                </div>
                <p className="cal-hint">{eventType.bookingUrl?.replace(window.location.origin, "") ?? ""}</p>
                <div className="cal-row cal-team__event-meta">
                  <Badge startIcon="clock">{durationLabel(eventType.lengthInMinutes)}</Badge>
                  <Badge startIcon="mapPin">{locationLabel(eventType.locations[0])}</Badge>
                  {eventType.hosts.length > 0 ? (
                    <span className="cal-row">
                      <AvatarGroup
                        people={eventType.hosts.map((host) => ({
                          name: host.name,
                          avatarUrl: host.avatarUrl,
                        }))}
                        size={20}
                      />
                      <span className="cal-hint">{eventType.hosts.length} hosts</span>
                    </span>
                  ) : (
                    <Badge tone="attention">No hosts assigned</Badge>
                  )}
                </div>
              </div>

              <div className="cal-row" onClick={(event) => event.stopPropagation()}>
                <Switch checked={!eventType.hidden} onChange={() => void toggleHidden(eventType)} size="sm" />
                <CopyButton value={`${window.location.origin}${eventType.bookingUrl?.replace(window.location.origin, "") ?? ""}`} />
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
                        {
                          label: "Edit",
                          onSelect: () => navigate(`/teams/${teamId}/event-types/${eventType.id}`),
                        },
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
        title="New team event"
        description="Pick how hosts are chosen; slots follow their availability."
        footer={
          <>
            <Button variant="minimal" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button loading={saving} disabled={!title.trim()} onClick={() => void create()}>
              Create
            </Button>
          </>
        }
      >
        <TextField
          label="Title"
          placeholder="Product demo"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setSlug(slugify(event.target.value));
          }}
        />
        <TextField label="URL" prefix="/team/…/" value={slug} onChange={(event) => setSlug(slugify(event.target.value))} />
        <TextArea label="Description" value={description} onChange={(event) => setDescription(event.target.value)} />
        <NumberField label="Duration" suffix="minutes" min={1} value={duration} onValueChange={setDuration} />
        <RadioGroup
          label="Scheduling"
          value={schedulingType}
          onChange={(next) => setSchedulingType(next)}
          options={[
            { value: "collective", label: "Collective", description: "All hosts must be free." },
            { value: "roundRobin", label: "Round robin", description: "One available host per booking." },
            { value: "managed", label: "Managed", description: "Each member gets their own copy." },
          ]}
        />
        <Select
          label="Hosts"
          placeholder="All accepted members"
          value={null}
          options={accepted.map((membership) => ({
            value: membership.userId,
            label: membership.user?.name || membership.user?.email || `User ${membership.userId}`,
          }))}
          onChange={(userId) => setHostIds((current) => (current.includes(userId) ? current : [...current, userId]))}
        />
        {hostIds.length > 0 ? (
          <p className="cal-hint">
            {hostIds.length} host(s) selected.{" "}
            <button type="button" className="cal-link-button" onClick={() => setHostIds([])}>
              clear
            </button>
          </p>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
        title="Delete team event"
        description={`"${deleteTarget?.title ?? ""}" stops accepting bookings. Existing bookings are kept.`}
        confirmLabel="Delete"
        destructive
      />
    </div>
  );
}

function TeamMembers({
  teamId,
  members,
  onReload,
}: {
  teamId: number;
  members: Membership[] | null;
  onReload: () => Promise<void>;
}) {
  const toast = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("MEMBER");
  const [saving, setSaving] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Membership | null>(null);

  const invite = async (): Promise<void> => {
    setSaving(true);
    try {
      const result = await api.post<Array<{ email: string; status: string; token?: string }>>(
        `/v2/teams/${teamId}/invite`,
        { email, role }
      );
      const pending = result.find((entry) => entry.status === "invited");
      toast.success(pending?.token ? `Invite created. Token: ${pending.token}` : `${email} added`);
      setInviteOpen(false);
      setEmail("");
      await onReload();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const patch = async (membership: Membership, body: Record<string, unknown>): Promise<void> => {
    try {
      await api.patch(`/v2/teams/${teamId}/memberships/${membership.id}`, body);
      await onReload();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const remove = async (): Promise<void> => {
    if (!removeTarget) return;
    try {
      await api.delete(`/v2/teams/${teamId}/memberships/${removeTarget.id}`);
      setRemoveTarget(null);
      await onReload();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (!members) return <Skeleton height={180} />;

  return (
    <div className="cal-stack">
      <div className="cal-row">
        <p className="cal-hint">Members can be assigned as hosts on this team's event types.</p>
        <div className="cal-spacer" />
        <Button startIcon="plus" onClick={() => setInviteOpen(true)}>
          Add member
        </Button>
      </div>

      <List>
        {members.map((membership) => (
          <ListRow key={membership.id}>
            <Avatar name={membership.user?.name ?? "?"} src={membership.user?.avatarUrl} size={32} />
            <div className="cal-team__what">
              <div className="cal-row">
                <strong>{membership.user?.name ?? `User ${membership.userId}`}</strong>
                {membership.accepted ? null : <Badge tone="attention">Pending</Badge>}
              </div>
              <p className="cal-hint">{membership.user?.email}</p>
            </div>
            <div style={{ width: 150 }}>
              <Select
                size="sm"
                value={membership.role}
                options={ROLES.map((value) => ({ value, label: value }))}
                onChange={(next) => void patch(membership, { role: next })}
              />
            </div>
            {membership.accepted ? null : (
              <Button size="sm" variant="secondary" onClick={() => void patch(membership, { accepted: true })}>
                Accept
              </Button>
            )}
            <IconButton
              icon="trash"
              label="Remove member"
              variant="minimal"
              size="sm"
              onClick={() => setRemoveTarget(membership)}
            />
          </ListRow>
        ))}
      </List>

      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Add a team member"
        description="Existing users are added straight away; unknown emails get an invite token."
        footer={
          <>
            <Button variant="minimal" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button loading={saving} disabled={!email.includes("@")} onClick={() => void invite()}>
              Send invite
            </Button>
          </>
        }
      >
        <TextField label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <Select
          label="Role"
          value={role}
          options={ROLES.map((value) => ({ value, label: value }))}
          onChange={(next) => setRole(next)}
        />
      </Dialog>

      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => void remove()}
        title="Remove member"
        description="They stop being a host on this team's event types."
        confirmLabel="Remove"
        destructive
      />
    </div>
  );
}

function TeamAvailability({ teamId, members }: { teamId: number; members: Membership[] }) {
  const timeFormat = useTimeFormat();
  const toast = useToast();
  const [rows, setRows] = useState<Array<Schedule & { ownerUsername?: string }> | null>(null);

  useEffect(() => {
    void api
      .get<Array<Schedule & { ownerUsername?: string }>>(`/v2/teams/${teamId}/schedules`)
      .then(setRows)
      .catch((error) => {
        toast.error(errorMessage(error));
        setRows([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  if (!rows) return <Skeleton height={180} />;

  return (
    <div className="cal-stack">
      <p className="cal-hint">
        Each member's own schedules. Team event slots are built from these, minus anything already
        booked anywhere else.
      </p>
      <List>
        {rows.length === 0 ? (
          <ListRow>
            <p className="cal-hint">No schedules found for this team.</p>
          </ListRow>
        ) : null}
        {rows.map((schedule) => {
          const member = members.find((membership) => membership.userId === schedule.ownerId);
          return (
            <ListRow key={`${schedule.ownerId}-${schedule.id}`}>
              <Avatar name={member?.user?.name ?? schedule.ownerUsername ?? "?"} size={28} />
              <div className="cal-team__what">
                <strong>{member?.user?.name ?? schedule.ownerUsername}</strong>
                <p className="cal-hint">
                  {schedule.name} · {schedule.timeZone}
                </p>
                {schedule.availability ? (
                  <p className="cal-hint">{availabilitySummary(schedule.availability, timeFormat)}</p>
                ) : null}
              </div>
              {schedule.isDefault ? <Badge tone="info">Default</Badge> : null}
            </ListRow>
          );
        })}
      </List>
    </div>
  );
}
