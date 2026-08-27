import { useEffect, useState } from "react";
import { Button } from "../ui/Button.tsx";
import { Avatar, Badge, EmptyState, List, ListRow, PageHeader, SkeletonList } from "../ui/Layout.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { Invitation, Team } from "../lib/types.ts";
import { useRouter } from "../app/router.tsx";

export function TeamsPage() {
  const { navigate } = useRouter();
  const toast = useToast();

  const [teams, setTeams] = useState<Team[] | null>(null);
  const [orgs, setOrgs] = useState<Team[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [responding, setResponding] = useState<number | null>(null);

  const load = async (): Promise<void> => {
    try {
      const [teamList, orgList, inviteList] = await Promise.all([
        api.get<Team[]>("/v2/teams"),
        api.get<Team[]>("/v2/organizations"),
        api.get<Invitation[]>("/v2/teams/invitations"),
      ]);
      setTeams(teamList);
      setOrgs(orgList);
      setInvitations(inviteList);
    } catch (error) {
      toast.error(errorMessage(error));
      setTeams([]);
    }
  };

  const respond = async (invitation: Invitation, accept: boolean): Promise<void> => {
    setResponding(invitation.id);
    try {
      if (invitation.kind === "token") {
        await api.post(
          accept ? "/v2/teams/invites/accept" : "/v2/teams/invites/decline",
          { token: invitation.token }
        );
      } else {
        await api.post(
          `/v2/teams/invitations/${invitation.id}/${accept ? "accept" : "decline"}`,
          {}
        );
      }
      toast.success(accept ? `You joined ${invitation.teamName}` : "Invitation declined");
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setResponding(null);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PageHeader
        title="Teams"
        subtitle="Book meetings together — collectively or round robin."
        actions={
          <>
            <Button
              variant="secondary"
              startIcon="building"
              onClick={() => navigate("/teams/new?type=organization")}
            >
              New organization
            </Button>
            <Button startIcon="plus" onClick={() => navigate("/teams/new")}>
              New team
            </Button>
          </>
        }
      />

      {invitations.length > 0 ? (
        <div className="cal-stack" style={{ marginBottom: 20 }}>
          <p className="cal-section-title">
            Invitations
            <Badge tone="attention">{invitations.length}</Badge>
          </p>
          <List>
            {invitations.map((invitation) => (
              <ListRow key={`${invitation.kind}-${invitation.id}`}>
                <Avatar
                  name={invitation.teamName}
                  size={30}
                  colorKey={invitation.teamSlug ?? invitation.teamName}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cal-row">
                    <strong>{invitation.teamName}</strong>
                    <Badge>{invitation.role}</Badge>
                    {invitation.isOrganization ? <Badge tone="info">Organization</Badge> : null}
                  </div>
                  <p className="cal-hint">
                    {invitation.invitedBy
                      ? `${invitation.invitedBy} invited you to join`
                      : "You have been invited to join"}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={responding === invitation.id}
                  onClick={() => void respond(invitation, false)}
                >
                  Decline
                </Button>
                <Button
                  size="sm"
                  loading={responding === invitation.id}
                  onClick={() => void respond(invitation, true)}
                >
                  Accept
                </Button>
              </ListRow>
            ))}
          </List>
        </div>
      ) : null}

      {orgs.length > 0 ? (
        <div className="cal-stack" style={{ marginBottom: 20 }}>
          <p className="cal-section-title">Organizations</p>
          <List>
            {orgs.map((org) => (
              <ListRow key={org.id} onClick={() => navigate("/settings/organization/members")}>
                <Avatar name={org.name} src={org.logoUrl} size={30} colorKey={org.slug ?? org.name} />
                <div style={{ flex: 1 }}>
                  <strong>{org.name}</strong>
                  <p className="cal-hint">/{org.slug}</p>
                </div>
                <Badge tone="info">Organization</Badge>
              </ListRow>
            ))}
          </List>
        </div>
      ) : null}

      {teams === null ? (
        <SkeletonList rows={2} />
      ) : teams.length === 0 ? (
        <EmptyState
          icon="users"
          title="Create a team"
          description="Teams let you host collective or round robin events with your colleagues."
          action={
            <Button startIcon="plus" onClick={() => navigate("/teams/new")}>
              New team
            </Button>
          }
        />
      ) : (
        <List>
          {teams.map((team) => (
            <ListRow key={team.id} onClick={() => navigate(`/teams/${team.id}/dashboard`)}>
              <Avatar name={team.name} src={team.logoUrl} size={30} colorKey={team.slug ?? team.name} />
              <div style={{ flex: 1 }}>
                <strong>{team.name}</strong>
                <p className="cal-hint">/team/{team.slug}</p>
              </div>
              {team.parentId ? <Badge>In organization</Badge> : null}
              <Button
                size="sm"
                variant="secondary"
                onClick={(event) => {
                  event.stopPropagation();
                  navigate(`/teams/${team.id}/event-types`);
                }}
              >
                Event types
              </Button>
            </ListRow>
          ))}
        </List>
      )}

    </>
  );
}
