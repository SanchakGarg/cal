import { useState } from "react";
import { Button } from "./Button.tsx";
import { TextArea, TextField } from "./Field.tsx";
import { ImageUpload } from "./ImageUpload.tsx";
import { SettingsSection } from "./Layout.tsx";
import { useToast } from "./Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { Team } from "../lib/types.ts";

/**
 * The public identity of a team or an organisation. Both live in the same table
 * and appear on the same kind of public page, so they are edited by one form —
 * only the endpoint differs.
 */
export function TeamProfileSettings({
  team,
  endpoint,
  onSaved,
}: {
  team: Team;
  /** `/v2/teams/:id` or `/v2/organizations/:id`. */
  endpoint: string;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const noun = team.isOrganization ? "organization" : "team";
  const [draft, setDraft] = useState({
    name: team.name,
    bio: team.bio ?? "",
    logoUrl: team.logoUrl ?? "",
    websiteUrl: team.websiteUrl ?? "",
    contactEmail: team.contactEmail ?? "",
    contactPhone: team.contactPhone ?? "",
    location: team.location ?? "",
  });
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<typeof draft>): void => setDraft((current) => ({ ...current, ...patch }));

  const dirty =
    draft.name !== team.name ||
    draft.bio !== (team.bio ?? "") ||
    draft.logoUrl !== (team.logoUrl ?? "") ||
    draft.websiteUrl !== (team.websiteUrl ?? "") ||
    draft.contactEmail !== (team.contactEmail ?? "") ||
    draft.contactPhone !== (team.contactPhone ?? "") ||
    draft.location !== (team.location ?? "");

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await api.patch(endpoint, draft);
      toast.success("Profile saved");
      await onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const saveButton = (
    <Button loading={saving} disabled={!dirty} onClick={() => void save()}>
      Save changes
    </Button>
  );

  return (
    <div className="cal-stack">
      <SettingsSection
        title="Public profile"
        description={`How your ${noun} appears to anyone opening its booking page.`}
        footer={saveButton}
      >
        <ImageUpload
          value={draft.logoUrl || null}
          onChange={(url) => set({ logoUrl: url ?? "" })}
          name={draft.name || team.name}
          colorKey={team.slug ?? team.name}
          label="Logo"
          hint="PNG, JPEG, GIF or WebP, up to 2MB. Without one, the initials shown here are used."
        />
        <TextField label="Name" value={draft.name} onChange={(event) => set({ name: event.target.value })} />
        <TextArea
          label="Description"
          placeholder={`What your ${noun} does, and what people can book.`}
          hint="Shown under the name on your booking page."
          value={draft.bio}
          onChange={(event) => set({ bio: event.target.value })}
        />
      </SettingsSection>

      <SettingsSection
        title="Contact and location"
        description="Optional. Anything you fill in is published on the booking page, so leave out what you would rather not share."
        footer={saveButton}
      >
        <TextField
          label="Website"
          placeholder="https://example.com"
          value={draft.websiteUrl}
          onChange={(event) => set({ websiteUrl: event.target.value })}
        />
        <TextField
          label="Contact email"
          type="email"
          placeholder="hello@example.com"
          value={draft.contactEmail}
          onChange={(event) => set({ contactEmail: event.target.value })}
        />
        <TextField
          label="Contact phone"
          placeholder="+91 98765 43210"
          value={draft.contactPhone}
          onChange={(event) => set({ contactPhone: event.target.value })}
        />
        <TextField
          label="Location"
          placeholder="Sonipat, Haryana"
          value={draft.location}
          onChange={(event) => set({ location: event.target.value })}
        />
      </SettingsSection>
    </div>
  );
}
