import { useEffect, useState } from "react";
import { Button, IconButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { TextField } from "../ui/Field.tsx";
import { Avatar, Badge, List, ListRow, PageHeader, Skeleton, Tabs } from "../ui/Layout.tsx";
import { Select } from "../ui/Select.tsx";
import { TeamProfileSettings } from "../ui/TeamProfileSettings.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { Membership, Schedule, Team } from "../lib/types.ts";
import { availabilitySummary } from "../lib/time.ts";
import { useAuth, useTimeFormat } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";

type OrgTab = "profile" | "members" | "teams" | "availability";

interface OrgUser {
  id: number;
  name: string;
  email: string;
  username: string;
  role: string;
  accepted: boolean;
  timeZone: string;
}

export function OrganizationPage({ tab }: { tab: OrgTab }) {
  const { me } = useAuth();
  const timeFormat = useTimeFormat();
  const { navigate } = useRouter();
  const toast = useToast();
  const orgId = me?.organizationId ?? null;

  const [org, setOrg] = useState<Team | null>(null);
  const [users, setUsers] = useState<OrgUser[] | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [schedules, setSchedules] = useState<Array<Schedule & { ownerUsername?: string }>>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"OWNER" | "ADMIN" | "MEMBER">("MEMBER");
  const [saving, setSaving] = useState(false);
  const [memberships, setMemberships] = useState<Membership[]>([]);

  const load = async (): Promise<void> => {
    if (!orgId) return;
    try {
      const [orgProfile, userList, teamList, membershipList] = await Promise.all([
        api.get<Team>(`/v2/organizations/${orgId}`),
        api.get<OrgUser[]>(`/v2/organizations/${orgId}/users`),
        api.get<Team[]>(`/v2/organizations/${orgId}/teams`),
        api.get<Membership[]>(`/v2/organizations/${orgId}/memberships`),
      ]);
      setOrg(orgProfile);
      setUsers(userList);
      setTeams(teamList);
      setMemberships(membershipList);
      if (tab === "availability") {
        const first = userList[0];
        if (first) {
          setSchedules(
            await api.get<Schedule[]>(`/v2/organizations/${orgId}/users/${first.id}/schedules`)
          );
        }
      }
    } catch (error) {
      toast.error(errorMessage(error));
      setUsers([]);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, tab]);

  const addUser = async (): Promise<void> => {
    if (!orgId) return;
    setSaving(true);
    try {
      await api.post(`/v2/organizations/${orgId}/users`, {
        email,
        name: name || undefined,
        role,
        accepted: true,
      });
      toast.success("Member added");
      setAddOpen(false);
      setEmail("");
      setName("");
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (user: OrgUser, nextRole: string): Promise<void> => {
    if (!orgId) return;
    try {
      await api.patch(`/v2/organizations/${orgId}/users/${user.id}`, { role: nextRole });
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const removeUser = async (user: OrgUser): Promise<void> => {
    if (!orgId) return;
    try {
      await api.delete(`/v2/organizations/${orgId}/users/${user.id}`);
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const loadUserSchedules = async (userId: number): Promise<void> => {
    if (!orgId) return;
    try {
      setSchedules(await api.get<Schedule[]>(`/v2/organizations/${orgId}/users/${userId}/schedules`));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (!orgId) {
    return (
      <>
        <PageHeader title="Organization" />
        <p className="cal-muted">You are not part of an organization yet. Create one from the Teams page.</p>
        <div style={{ marginTop: 12 }}>
          <Button onClick={() => navigate("/teams")}>Go to teams</Button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={org?.name ?? "Organization"}
        subtitle="Your public page, members, teams and their availability."
        actions={
          tab === "members" ? (
            <Button startIcon="plus" onClick={() => setAddOpen(true)}>
              Add member
            </Button>
          ) : undefined
        }
      />

      <Tabs
        value={tab}
        onChange={(next) => navigate(`/settings/organization/${next}`)}
        tabs={[
          { value: "profile", label: "Profile" },
          { value: "members", label: "Members", count: users?.length },
          { value: "teams", label: "Teams", count: teams.length },
          { value: "availability", label: "Availability" },
        ]}
      />

      <div style={{ paddingTop: 16 }}>
        {tab === "profile" ? (
          org === null ? (
            <Skeleton height={320} />
          ) : (
            <TeamProfileSettings
              team={org}
              endpoint={`/v2/organizations/${org.id}`}
              onSaved={load}
            />
          )
        ) : null}
        {tab === "members" ? (
          users === null ? (
            <Skeleton height={160} />
          ) : (
            <List>
              {users.map((user) => (
                <ListRow key={user.id}>
                  <Avatar name={user.name || user.email} size={32} colorKey={user.email} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="cal-row">
                      <strong>{user.name || user.email}</strong>
                      {user.accepted ? null : <Badge tone="attention">Invite pending</Badge>}
                    </div>
                    <p className="cal-hint">
                      {user.email} · {user.timeZone}
                    </p>
                  </div>
                  <div style={{ width: 150 }}>
                    <Select
                      size="sm"
                      value={user.role}
                      options={["OWNER", "ADMIN", "MEMBER"].map((value) => ({ value, label: value }))}
                      onChange={(next) => void changeRole(user, next)}
                    />
                  </div>
                  <IconButton
                    icon="trash"
                    label="Remove from organization"
                    variant="minimal"
                    size="sm"
                    onClick={() => void removeUser(user)}
                  />
                </ListRow>
              ))}
            </List>
          )
        ) : null}

        {tab === "teams" ? (
          <List>
            {teams.length === 0 ? (
              <ListRow>
                <p className="cal-hint">No teams in this organization yet.</p>
              </ListRow>
            ) : null}
            {teams.map((team) => {
              const count = memberships.filter((membership) => membership.teamId === team.id).length;
              return (
                <ListRow key={team.id} onClick={() => navigate(`/teams/${team.id}/dashboard`)}>
                  <Avatar name={team.name} src={team.logoUrl} size={30} colorKey={team.slug ?? team.name} />
                  <div style={{ flex: 1 }}>
                    <strong>{team.name}</strong>
                    <p className="cal-hint">/team/{team.slug}</p>
                  </div>
                  {count ? <Badge>{count} members</Badge> : null}
                </ListRow>
              );
            })}
          </List>
        ) : null}

        {tab === "availability" ? (
          <div className="cal-stack">
            <div style={{ maxWidth: 320 }}>
              <Select
                label="Member"
                value={users?.[0]?.id ?? null}
                options={(users ?? []).map((user) => ({ value: user.id, label: user.name || user.email }))}
                onChange={(userId) => void loadUserSchedules(userId)}
              />
            </div>
            <List>
              {schedules.length === 0 ? (
                <ListRow>
                  <p className="cal-hint">No schedules found for this member.</p>
                </ListRow>
              ) : null}
              {schedules.map((schedule) => (
                <ListRow key={schedule.id}>
                  <div style={{ flex: 1 }}>
                    <div className="cal-row">
                      <strong>{schedule.name}</strong>
                      {schedule.isDefault ? <Badge tone="info">Default</Badge> : null}
                    </div>
                    <p className="cal-hint">{availabilitySummary(schedule.availability, timeFormat)}</p>
                    <p className="cal-hint">{schedule.timeZone}</p>
                  </div>
                </ListRow>
              ))}
            </List>
          </div>
        ) : null}
      </div>

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add an organization member"
        description="If the email is unknown we create the account for them."
        footer={
          <>
            <Button variant="minimal" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button loading={saving} disabled={!email.includes("@")} onClick={() => void addUser()}>
              Add
            </Button>
          </>
        }
      >
        <TextField label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} />
        <Select
          label="Role"
          value={role}
          options={["OWNER", "ADMIN", "MEMBER"].map((value) => ({ value: value as typeof role, label: value }))}
          onChange={(next) => setRole(next)}
        />
      </Dialog>
    </>
  );
}

