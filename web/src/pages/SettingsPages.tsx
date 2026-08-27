import { useEffect, useState } from "react";
import { Button, IconButton } from "../ui/Button.tsx";
import { RadioGroup, TextArea, TextField } from "../ui/Field.tsx";
import { Badge, List, ListRow, PageHeader, SettingsSection, Tabs } from "../ui/Layout.tsx";
import { Select } from "../ui/Select.tsx";
import { TimezoneSelect } from "../ui/TimePickers.tsx";
import { ImageUpload } from "../ui/ImageUpload.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { Me, OooEntry } from "../lib/types.ts";
import { formatDateISO } from "../lib/time.ts";
import { useAuth } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";
import { CalendarSettings } from "./CalendarSettings.tsx";

export type SettingsTab = "profile" | "general" | "calendars" | "out-of-office";

export const SETTINGS_TABS: Array<{ value: SettingsTab; label: string }> = [
  { value: "profile", label: "Profile" },
  { value: "general", label: "General" },
  { value: "calendars", label: "Calendars" },
  { value: "out-of-office", label: "Out of office" },
];

export function SettingsPage({ tab }: { tab: SettingsTab }) {
  const { navigate } = useRouter();
  return (
    <>
      <PageHeader title="Settings" subtitle="Manage your account and how you appear to bookers." />
      <Tabs tabs={SETTINGS_TABS} value={tab} onChange={(next) => navigate(`/settings/${next}`)} />
      <div style={{ paddingTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        {tab === "profile" ? <ProfileSettings /> : null}
        {tab === "general" ? <GeneralSettings /> : null}
        {tab === "calendars" ? <CalendarSettings /> : null}
        {tab === "out-of-office" ? <OutOfOfficeSettings /> : null}
      </div>
    </>
  );
}

function ProfileSettings() {
  const { me, setMe } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(me?.name ?? "");
  const [username, setUsername] = useState(me?.username ?? "");
  const [email, setEmail] = useState(me?.email ?? "");
  const [bio, setBio] = useState(me?.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(me?.avatarUrl ?? null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!me) return;
    setName(me.name);
    setUsername(me.username);
    setEmail(me.email);
    setBio(me.bio ?? "");
    setAvatarUrl(me.avatarUrl ?? null);
  }, [me]);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      // Sent as an empty string rather than omitted, so removing the picture
      // actually clears it instead of leaving the old one in place.
      setMe(await api.patch<Me>("/v2/me", { name, username, email, bio, avatarUrl: avatarUrl ?? "" }));
      toast.success("Profile updated");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      title="Profile"
      description="This is what bookers see on your public page."
      footer={
        <Button loading={saving} onClick={() => void save()}>
          Update
        </Button>
      }
    >
      <ImageUpload
        value={avatarUrl}
        onChange={setAvatarUrl}
        name={name || me?.email || "You"}
        colorKey={me?.username ?? me?.email}
        label="Profile picture"
        hint="Replaces the one from your sign-in provider. PNG, JPEG, GIF or WebP, up to 2MB."
      />
      <TextField label="Full name" value={name} onChange={(event) => setName(event.target.value)} />
      <TextField
        label="Username"
        prefix={`${window.location.host}/`}
        value={username}
        onChange={(event) => setUsername(event.target.value)}
      />
      <TextField label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      <TextArea label="About" value={bio} onChange={(event) => setBio(event.target.value)} />
      {me?.isGuest ? <Badge tone="attention">Guest account</Badge> : null}
    </SettingsSection>
  );
}

function GeneralSettings() {
  const { me, setMe } = useAuth();
  const toast = useToast();
  const [timeZone, setTimeZone] = useState(me?.timeZone ?? "UTC");
  const [weekStart, setWeekStart] = useState(me?.weekStart ?? "Monday");
  const [timeFormat, setTimeFormat] = useState<"12" | "24">(me?.timeFormat === 24 ? "24" : "12");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!me) return;
    setTimeZone(me.timeZone);
    setWeekStart(me.weekStart);
    setTimeFormat(me.timeFormat === 24 ? "24" : "12");
  }, [me]);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      setMe(
        await api.patch<Me>("/v2/me", {
          timeZone,
          weekStart,
          timeFormat: Number(timeFormat),
        })
      );
      toast.success("Preferences updated");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      title="General"
      description="Timezone and formatting used across your calendar."
      footer={
        <Button loading={saving} onClick={() => void save()}>
          Update
        </Button>
      }
    >
      <TimezoneSelect label="Timezone" value={timeZone} onChange={setTimeZone} />
      <Select
        label="Start of week"
        value={weekStart}
        options={["Monday", "Sunday", "Saturday"].map((value) => ({ value, label: value }))}
        onChange={(next) => setWeekStart(next)}
      />
      <RadioGroup
        label="Time format"
        value={timeFormat}
        onChange={(next) => setTimeFormat(next)}
        options={[
          { value: "12", label: "12 hour", description: "9:00am" },
          { value: "24", label: "24 hour", description: "09:00" },
        ]}
      />
    </SettingsSection>
  );
}

function OutOfOfficeSettings() {
  const { navigate } = useRouter();
  const toast = useToast();

  const [entries, setEntries] = useState<OooEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async (): Promise<void> => {
    try {
      setEntries(await api.get<OooEntry[]>("/v2/me/ooo"));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (entry: OooEntry): Promise<void> => {
    try {
      await api.delete(`/v2/me/ooo/${entry.id}`);
      toast.success("Out of office removed");
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <>
      <SettingsSection
        title="Out of office"
        description="Block whole days — no slots are offered while you are away."
        footer={
          <Button startIcon="plus" onClick={() => navigate("/settings/out-of-office/new")}>
            Add
          </Button>
        }
      >
        <List>
          {loading ? (
            <ListRow>
              <p className="cal-hint">Loading…</p>
            </ListRow>
          ) : null}
          {!loading && entries.length === 0 ? (
            <ListRow>
              <p className="cal-hint">Nothing scheduled.</p>
            </ListRow>
          ) : null}
          {entries.map((entry) => (
            <ListRow key={entry.id}>
              <div style={{ flex: 1 }}>
                <strong>
                  {formatDateISO(entry.start, { weekday: "short" })} –{" "}
                  {formatDateISO(entry.end, { weekday: "short" })}
                </strong>
                <p className="cal-hint">
                  {entry.reason}
                  {entry.notes ? ` · ${entry.notes}` : ""}
                </p>
              </div>
              <IconButton
                icon="trash"
                label="Delete entry"
                variant="minimal"
                size="sm"
                onClick={() => void remove(entry)}
              />
            </ListRow>
          ))}
        </List>
      </SettingsSection>

    </>
  );
}
