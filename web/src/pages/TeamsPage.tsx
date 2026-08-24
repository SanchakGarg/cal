import { useEffect, useState } from "react";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { TextArea, TextField } from "../ui/Field.tsx";
import { Avatar, Badge, EmptyState, List, ListRow, PageHeader, Skeleton } from "../ui/Layout.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { Team } from "../lib/types.ts";
import { useAuth } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";

export function TeamsPage() {
  const { me, refresh } = useAuth();
  const { navigate } = useRouter();
  const toast = useToast();

  const [teams, setTeams] = useState<Team[] | null>(null);
  const [orgs, setOrgs] = useState<Team[]>([]);
  const [open, setOpen] = useState<"team" | "org" | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);

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

  const create = async (): Promise<void> => {
    setSaving(true);
    try {
      const body = { name, slug: slug || undefined, bio: bio || undefined };
      if (open === "org") {
        const org = await api.post<Team>("/v2/organizations", body);
        toast.success(`Organization ${org.name} created`);
      } else {
        const orgId = me?.organizationId;
        const team = orgId
          ? await api.post<Team>(`/v2/organizations/${orgId}/teams`, body)
          : await api.post<Team>("/v2/teams", body);
        toast.success(`Team ${team.name} created`);
      }
      setOpen(null);
      setName("");
      setSlug("");
      setBio("");
      await refresh();
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Teams"
        subtitle="Book meetings together — collectively or round robin."
        actions={
          <>
            <Button variant="secondary" startIcon="building" onClick={() => setOpen("org")}>
              New organization
            </Button>
            <Button startIcon="plus" onClick={() => setOpen("team")}>
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
                <Avatar name={org.name} src={org.logoUrl} size={30} />
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
        <Skeleton height={120} />
      ) : teams.length === 0 ? (
        <EmptyState
          icon="users"
          title="Create a team"
          description="Teams let you host collective or round robin events with your colleagues."
          action={
            <Button startIcon="plus" onClick={() => setOpen("team")}>
              New team
            </Button>
          }
        />
      ) : (
        <List>
          {teams.map((team) => (
            <ListRow key={team.id} onClick={() => navigate(`/teams/${team.id}/members`)}>
              <Avatar name={team.name} src={team.logoUrl} size={30} />
              <div style={{ flex: 1 }}>
                <strong>{team.name}</strong>
                <p className="cal-hint">/team/{team.slug}</p>
              </div>
              {team.parentId ? <Badge>In organization</Badge> : null}
              <Button size="sm" variant="secondary" onClick={() => navigate(`/event-types?team=${team.id}`)}>
                Event types
              </Button>
            </ListRow>
          ))}
        </List>
      )}

      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open === "org" ? "New organization" : "New team"}
        description={
          open === "org"
            ? "Organizations group teams and members together."
            : "Add a team to host events with colleagues."
        }
        footer={
          <>
            <Button variant="minimal" onClick={() => setOpen(null)}>
              Cancel
            </Button>
            <Button loading={saving} disabled={!name.trim()} onClick={() => void create()}>
              Create
            </Button>
          </>
        }
      >
        <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} />
        <TextField
          label="Slug"
          prefix={open === "org" ? "/" : "/team/"}
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
        />
        <TextArea label="About" value={bio} onChange={(event) => setBio(event.target.value)} />
      </Dialog>
    </>
  );
}
