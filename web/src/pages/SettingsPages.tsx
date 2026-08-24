import { useEffect, useState } from "react";
import { Button, IconButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { RadioGroup, TextArea, TextField } from "../ui/Field.tsx";
import { Badge, List, ListRow, PageHeader, SettingsSection, Tabs } from "../ui/Layout.tsx";
import { Select } from "../ui/Select.tsx";
import { TimezoneSelect } from "../ui/TimePickers.tsx";
import { MonthCalendar } from "../ui/Calendar.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { Me, OooEntry } from "../lib/types.ts";
import { formatDateISO, todayISO } from "../lib/time.ts";
import { useAuth } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";

type SettingsTab = "profile" | "general" | "out-of-office";

const TABS: Array<{ value: SettingsTab; label: string }> = [
  { value: "profile", label: "Profile" },
  { value: "general", label: "General" },
  { value: "out-of-office", label: "Out of office" },
];

export function SettingsPage({ tab }: { tab: SettingsTab }) {
  const { navigate } = useRouter();
  return (
    <>
      <PageHeader title="Settings" subtitle="Manage your account and how you appear to bookers." />
      <Tabs tabs={TABS} value={tab} onChange={(next) => navigate(`/settings/${next}`)} />
      <div style={{ paddingTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        {tab === "profile" ? <ProfileSettings /> : null}
        {tab === "general" ? <GeneralSettings /> : null}
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!me) return;
    setName(me.name);
    setUsername(me.username);
    setEmail(me.email);
    setBio(me.bio ?? "");
  }, [me]);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      setMe(await api.patch<Me>("/v2/me", { name, username, email, bio }));
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
  const { me } = useAuth();
  const toast = useToast();
  const timeZone = me?.timeZone ?? "UTC";

  const [entries, setEntries] = useState<OooEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => `${todayISO(timeZone).slice(0, 7)}-01`);
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [reason, setReason] = useState("vacation");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async (): Promise<void> => {
    try {
      setEntries(await api.get<OooEntry[]>("/v2/me/ooo"));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async (): Promise<void> => {
    if (!start) return;
    setSaving(true);
    try {
      await api.post("/v2/me/ooo", {
        start,
        end: end ?? start,
        reason,
        notes: notes || undefined,
      });
      toast.success("Out of office added");
      setOpen(false);
      setStart(null);
      setEnd(null);
      setNotes("");
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (entry: OooEntry): Promise<void> => {
    try {
      await api.delete(`/v2/me/ooo/${entry.id}`);
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
          <Button startIcon="plus" onClick={() => setOpen(true)}>
            Add
          </Button>
        }
      >
        <List>
          {entries.length === 0 ? (
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

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add out of office"
        description="Pick the first day, then the last day."
        width={620}
        footer={
          <>
            <Button variant="minimal" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={saving} disabled={!start} onClick={() => void create()}>
              Save
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 20 }}>
          <MonthCalendar
            month={month}
            onMonthChange={setMonth}
            selected={start}
            timeZone={timeZone}
            onSelect={(date) => {
              if (!start || (start && end)) {
                setStart(date);
                setEnd(null);
              } else if (date >= start) {
                setEnd(date);
              } else {
                setStart(date);
              }
            }}
          />
          <div className="cal-stack">
            <p className="cal-hint">
              {start ? `From ${formatDateISO(start)}` : "Pick a start date"}
              {end ? ` to ${formatDateISO(end)}` : ""}
            </p>
            <Select
              label="Reason"
              value={reason}
              options={["unspecified", "vacation", "travel", "sick", "public_holiday"].map((value) => ({
                value,
                label: value.replace("_", " "),
              }))}
              onChange={(next) => setReason(next)}
            />
            <TextArea label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
        </div>
      </Dialog>
    </>
  );
}
