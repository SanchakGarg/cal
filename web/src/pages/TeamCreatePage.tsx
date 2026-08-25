// Full-page "new team" / "new organization" flow.
import { useState } from "react";
import { Button } from "../ui/Button.tsx";
import { TextArea, TextField } from "../ui/Field.tsx";
import { PageHeader } from "../ui/Layout.tsx";
import { Alert } from "../ui/Alert.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { Team } from "../lib/types.ts";
import { useAuth } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";
import "./CreatePages.css";

const slugify = (value: string): string =>
  value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function TeamCreatePage({ kind }: { kind: "team" | "organization" }) {
  const { me, refresh } = useAuth();
  const { navigate } = useRouter();
  const toast = useToast();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugLocked, setSlugLocked] = useState(false);
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);

  const isOrg = kind === "organization";
  const effectiveSlug = slug || slugify(name);

  const create = async (): Promise<void> => {
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        slug: effectiveSlug || undefined,
        bio: bio.trim() || undefined,
      };
      if (isOrg) {
        const org = await api.post<Team>("/v2/organizations", body);
        await refresh();
        toast.success(`${org.name} created`);
        navigate("/settings/organization/members");
        return;
      }
      const orgId = me?.organizationId;
      const team = orgId
        ? await api.post<Team>(`/v2/organizations/${orgId}/teams`, body)
        : await api.post<Team>("/v2/teams", body);
      await refresh();
      toast.success(`${team.name} created`, { description: "Invite people to start booking." });
      navigate(`/teams/${team.id}/members`);
    } catch (error) {
      toast.error(errorMessage(error));
      setSaving(false);
    }
  };

  return (
    <div className="cal-form-page">
      <PageHeader
        title={isOrg ? "New organization" : "New team"}
        subtitle={
          isOrg
            ? "Organizations group teams and members together."
            : "Teams host collective or round robin events with your colleagues."
        }
        onBack={() => navigate("/teams")}
      />

      <div className="cal-card cal-form-page__card">
        <TextField
          label="Name"
          required
          placeholder={isOrg ? "Acme Inc" : "Design"}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (!slugLocked) setSlug(slugify(event.target.value));
          }}
        />
        <TextField
          label="Slug"
          prefix={isOrg ? "/" : "/team/"}
          hint="Used in the public booking link."
          value={effectiveSlug}
          onChange={(event) => {
            setSlugLocked(true);
            setSlug(slugify(event.target.value));
          }}
        />
        <TextArea
          label="About"
          placeholder="A short introduction shown on the public page."
          value={bio}
          onChange={(event) => setBio(event.target.value)}
        />

        <Alert tone="info" title={isOrg ? "You will be the owner" : "You will be the team owner"}>
          {isOrg
            ? "You can add teams and members from organization settings once it exists."
            : "After creating the team you can invite members and add team event types."}
        </Alert>

        <div className="cal-form-page__footer">
          <Button variant="minimal" onClick={() => navigate("/teams")}>
            Cancel
          </Button>
          <div className="cal-spacer" />
          <Button loading={saving} disabled={!name.trim()} onClick={() => void create()}>
            {isOrg ? "Create organization" : "Create team"}
          </Button>
        </div>
      </div>
    </div>
  );
}
