// Full-page "new event type" flow, for both personal and team events.
import { useEffect, useState } from "react";
import { Button } from "../ui/Button.tsx";
import { NumberField, RadioGroup, TextArea, TextField } from "../ui/Field.tsx";
import { PageHeader } from "../ui/Layout.tsx";
import { MultiSelect } from "../ui/Select.tsx";
import { Alert } from "../ui/Alert.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { EventType, Membership, Team } from "../lib/types.ts";
import { useAuth } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";
import "./CreatePages.css";

const slugify = (value: string): string =>
  value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const DURATION_PRESETS = [15, 30, 45, 60];

type SchedulingType = "collective" | "roundRobin" | "managed";

export function EventTypeCreatePage({ teamId }: { teamId?: number }) {
  const { me } = useAuth();
  const { navigate } = useRouter();
  const toast = useToast();

  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<Membership[]>([]);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugLocked, setSlugLocked] = useState(false);
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState<number | "">(teamId ? 30 : 15);
  const [schedulingType, setSchedulingType] = useState<SchedulingType>("collective");
  const [hostIds, setHostIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (teamId === undefined) return;
    void api.get<Team>(`/v2/teams/${teamId}`).then(setTeam).catch(() => setTeam(null));
    void api
      .get<Membership[]>(`/v2/teams/${teamId}/memberships`)
      .then((rows) => setMembers(rows.filter((membership) => membership.accepted)))
      .catch(() => setMembers([]));
  }, [teamId]);

  const backTarget = teamId ? `/teams/${teamId}/event-types` : "/event-types";
  const effectiveSlug = slug || slugify(title);
  const linkPrefix = teamId ? `/team/${team?.slug ?? "…"}/` : `/${me?.username ?? ""}/`;

  const create = async (): Promise<void> => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        slug: effectiveSlug,
        lengthInMinutes: duration === "" ? 15 : duration,
        description: description.trim(),
      };
      if (teamId !== undefined) {
        body.schedulingType = schedulingType;
        const chosen = hostIds.length ? hostIds : members.map((membership) => membership.userId);
        body.hosts = chosen.map((userId) => ({
          userId,
          mandatory: schedulingType === "collective",
        }));
      }
      const created = await api.post<EventType>(
        teamId === undefined ? "/v2/event-types" : `/v2/teams/${teamId}/event-types`,
        body
      );
      toast.success(`${created.title} created`, { description: "Opening the event editor." });
      navigate(
        teamId === undefined
          ? `/event-types/${created.id}`
          : `/teams/${teamId}/event-types/${created.id}`
      );
    } catch (error) {
      toast.error(errorMessage(error));
      setSaving(false);
    }
  };

  const invalid = !title.trim() || !effectiveSlug;

  return (
    <div className="cal-form-page">
      <PageHeader
        title={teamId ? "New team event" : "New event type"}
        subtitle={
          teamId
            ? "Pick how hosts are chosen; slots follow their availability."
            : "Create an event type for people to book time with you."
        }
        onBack={() => navigate(backTarget)}
      />

      <div className="cal-card cal-form-page__card">
        <div className="cal-form-page__section">
          <TextField
            label="Title"
            required
            placeholder={teamId ? "Product demo" : "Quick chat"}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              if (!slugLocked) setSlug(slugify(event.target.value));
            }}
          />
          <TextField
            label="URL"
            prefix={linkPrefix}
            hint="This is the link people will book on."
            value={effectiveSlug}
            onChange={(event) => {
              setSlugLocked(true);
              setSlug(slugify(event.target.value));
            }}
          />
          <TextArea
            label="Description"
            placeholder="A quick meeting to talk things through."
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />

          <div className="cal-form-page__section">
            <NumberField
              label="Duration"
              suffix="minutes"
              min={1}
              max={1440}
              value={duration}
              onValueChange={setDuration}
            />
            <div className="cal-row">
              {DURATION_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  size="sm"
                  variant={duration === preset ? "primary" : "secondary"}
                  onClick={() => setDuration(preset)}
                >
                  {preset} min
                </Button>
              ))}
            </div>
          </div>
        </div>

        {teamId !== undefined ? (
          <div className="cal-form-page__section">
            <RadioGroup
              label="Scheduling"
              value={schedulingType}
              onChange={setSchedulingType}
              options={[
                { value: "collective", label: "Collective", description: "All hosts must be free." },
                {
                  value: "roundRobin",
                  label: "Round robin",
                  description: "One available host per booking.",
                },
                { value: "managed", label: "Managed", description: "Each member gets their own copy." },
              ]}
            />
            <MultiSelect
              label="Hosts"
              hint="Leave empty to assign every accepted member."
              placeholder="All accepted members"
              values={hostIds}
              options={members.map((membership) => ({
                value: membership.userId,
                label:
                  membership.user?.name ||
                  membership.user?.email ||
                  `User ${membership.userId}`,
              }))}
              onChange={setHostIds}
            />
            {members.length === 0 ? (
              <Alert tone="warning" title="This team has no accepted members yet">
                The event will be created without hosts, so it cannot take bookings until someone
                accepts their invite.
              </Alert>
            ) : null}
          </div>
        ) : null}

        <div className="cal-form-page__footer">
          <Button variant="minimal" onClick={() => navigate(backTarget)}>
            Cancel
          </Button>
          <div className="cal-spacer" />
          <Button loading={saving} disabled={invalid} onClick={() => void create()}>
            Create and continue
          </Button>
        </div>
      </div>
    </div>
  );
}
