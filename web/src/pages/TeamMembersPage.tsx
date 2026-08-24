import { useEffect, useState } from "react";
import { Button, IconButton } from "../ui/Button.tsx";
import { ConfirmDialog, Dialog } from "../ui/Dialog.tsx";
import { TextField } from "../ui/Field.tsx";
import { Avatar, Badge, List, ListRow, PageHeader, Skeleton, Tabs } from "../ui/Layout.tsx";
import { Select } from "../ui/Select.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { Membership, Team } from "../lib/types.ts";
import { useRouter } from "../app/router.tsx";

const ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;

export function TeamMembersPage({ teamId }: { teamId: number }) {
  const { navigate } = useRouter();
  const toast = useToast();

  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<Membership[] | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("MEMBER");
  const [saving, setSaving] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Membership | null>(null);

  const load = async (): Promise<void> => {
    try {
      const [teamData, membershipData] = await Promise.all([
        api.get<Team>(`/v2/teams/${teamId}`),
        api.get<Membership[]>(`/v2/teams/${teamId}/memberships`),
      ]);
      setTeam(teamData);
      setMembers(membershipData);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const invite = async (): Promise<void> => {
    setSaving(true);
    try {
      const result = await api.post<Array<{ email: string; status: string; token?: string }>>(
        `/v2/teams/${teamId}/invite`,
        { email, role }
      );
      const pending = result.find((entry) => entry.status === "invited");
      toast.success(
        pending?.token
          ? `Invite created. Token: ${pending.token}`
          : `${email} added to the team`
      );
      setInviteOpen(false);
      setEmail("");
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (membership: Membership, nextRole: string): Promise<void> => {
    try {
      await api.patch(`/v2/teams/${teamId}/memberships/${membership.id}`, { role: nextRole });
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const accept = async (membership: Membership): Promise<void> => {
    try {
      await api.patch(`/v2/teams/${teamId}/memberships/${membership.id}`, { accepted: true });
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const remove = async (): Promise<void> => {
    if (!removeTarget) return;
    try {
      await api.delete(`/v2/teams/${teamId}/memberships/${removeTarget.id}`);
      setRemoveTarget(null);
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <>
      <PageHeader
        title={team?.name ?? "Team"}
        subtitle={team ? `/team/${team.slug}` : undefined}
        onBack={() => navigate("/teams")}
        actions={
          <Button startIcon="plus" onClick={() => setInviteOpen(true)}>
            Add member
          </Button>
        }
      />

      <Tabs
        value="members"
        onChange={(next) => {
          if (next === "events") navigate(`/event-types?team=${teamId}`);
        }}
        tabs={[
          { value: "members", label: "Members" },
          { value: "events", label: "Event types" },
        ]}
      />

      <div style={{ paddingTop: 16 }}>
        {members === null ? (
          <Skeleton height={140} />
        ) : (
          <List>
            {members.map((membership) => (
              <ListRow key={membership.id}>
                <Avatar name={membership.user?.name ?? "?"} src={membership.user?.avatarUrl} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
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
                    onChange={(next) => void changeRole(membership, next)}
                  />
                </div>
                {membership.accepted ? null : (
                  <Button size="sm" variant="secondary" onClick={() => void accept(membership)}>
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
        )}
      </div>

      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Add a team member"
        description="Existing users are added straight away; new emails get an invite token."
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
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
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
        description="They lose access to this team's event types and stop being assigned as a host."
        confirmLabel="Remove"
        destructive
      />
    </>
  );
}
