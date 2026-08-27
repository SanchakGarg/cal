import { useEffect, useState } from "react";
import { Button } from "../ui/Button.tsx";
import { Avatar, Badge, EmptyState, List, ListRow, PageHeader, SkeletonList } from "../ui/Layout.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { Team } from "../lib/types.ts";
import { useRouter } from "../app/router.tsx";

export function TeamsPage() {
  const { navigate } = useRouter();
  const toast = useToast();

  const [teams, setTeams] = useState<Team[] | null>(null);
  const [orgs, setOrgs] = useState<Team[]>([]);

  const load = async (): Promise<void> => {
    try {
      const [teamList, orgList] = await Promise.all([
        api.get<Team[]>("/v2/teams"),
        api.get<Team[]>("/v2/organizations"),
      ]);
      setTeams(teamList);
      setOrgs(orgList);
    } catch (error) {
      toast.error(errorMessage(error));
      setTeams([]);
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
