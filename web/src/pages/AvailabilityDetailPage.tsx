import { useEffect, useMemo, useState } from "react";
import { Button, IconButton } from "../ui/Button.tsx";
import { TextField } from "../ui/Field.tsx";
import { PageHeader, Skeleton } from "../ui/Layout.tsx";
import { Switch } from "../ui/Switch.tsx";
import { TimezoneSelect } from "../ui/TimePickers.tsx";
import { useToast } from "../ui/Toast.tsx";
import {
  DateOverrideList,
  type OverrideEntry,
  type WeeklySchedule,
  WeeklyEditor,
  blocksToWeek,
  weekToBlocks,
} from "../ui/AvailabilityEditor.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { Schedule } from "../lib/types.ts";
import { useAuth, useTimeFormat } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";
import "./AvailabilityDetailPage.css";

export function AvailabilityDetailPage({ scheduleId }: { scheduleId: number }) {
  const { navigate } = useRouter();
  const { refresh } = useAuth();
  const timeFormat = useTimeFormat();
  const toast = useToast();

  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [name, setName] = useState("");
  const [timeZone, setTimeZone] = useState("UTC");
  const [isDefault, setIsDefault] = useState(false);
  const [excludeFromTeam, setExcludeFromTeam] = useState(false);
  const [week, setWeek] = useState<WeeklySchedule | null>(null);
  const [overrides, setOverrides] = useState<OverrideEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [savingOverrides, setSavingOverrides] = useState(false);

  useEffect(() => {
    void api
      .get<Schedule>(`/v2/schedules/${scheduleId}`)
      .then((data) => {
        setSchedule(data);
        setName(data.name);
        setTimeZone(data.timeZone);
        setIsDefault(data.isDefault);
        setExcludeFromTeam(data.excludeFromTeam);
        setWeek(blocksToWeek(data.availability));
        setOverrides(data.overrides);
      })
      .catch((error) => toast.error(errorMessage(error)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleId]);

  /** Overrides save the moment they change — no Save press needed. */
  const commitOverrides = async (next: OverrideEntry[]): Promise<void> => {
    const previous = overrides;
    setOverrides(next);
    setSavingOverrides(true);
    try {
      await api.patch<Schedule>(`/v2/schedules/${scheduleId}`, { overrides: next });
      toast.success(next.length > previous.length ? "Override added" : "Overrides updated");
    } catch (error) {
      setOverrides(previous);
      toast.error(errorMessage(error));
    } finally {
      setSavingOverrides(false);
    }
  };

  // Compare against the loaded schedule so the Save button reflects real changes.
  const dirty = useMemo(() => {
    if (!schedule || !week) return false;
    return (
      name !== schedule.name ||
      timeZone !== schedule.timeZone ||
      isDefault !== schedule.isDefault ||
      excludeFromTeam !== schedule.excludeFromTeam ||
      JSON.stringify(weekToBlocks(week)) !== JSON.stringify(schedule.availability)
    );
  }, [schedule, week, name, timeZone, isDefault, excludeFromTeam]);

  const save = async (): Promise<void> => {
    if (!week) return;
    setSaving(true);
    try {
      const updated = await api.patch<Schedule>(`/v2/schedules/${scheduleId}`, {
        name,
        timeZone,
        isDefault,
        excludeFromTeam,
        availability: weekToBlocks(week),
        overrides,
      });
      setSchedule(updated);
      await refresh();
      toast.success("Availability saved", {
        action: { label: "Back to list", onClick: () => navigate("/availability") },
      });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const leave = (): void => {
    if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    navigate("/availability");
  };

  if (!schedule || !week) {
    return (
      <>
        <PageHeader title="Availability" />
        <div className="cal-stack">
          <Skeleton height={40} />
          <Skeleton height={300} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={name || schedule.name}
        subtitle="Set your weekly hours and override individual dates."
        onBack={leave}
        actions={
          <>
            <div className="cal-row cal-availability__default">
              <Switch checked={isDefault} onChange={setIsDefault} size="sm" label="Set to default" />
            </div>
            <IconButton
              icon="search"
              label="Troubleshoot"
              variant="secondary"
              onClick={() => navigate("/availability/troubleshoot")}
            />
            <Button loading={saving} disabled={!dirty} onClick={() => void save()}>
              Save
            </Button>
          </>
        }
      />

      {dirty ? (
        <div className="cal-unsaved-bar" role="status">
          <span>Unsaved changes</span>
          <div className="cal-row">
            <Button
              variant="minimal"
              onClick={() => {
                setName(schedule.name);
                setTimeZone(schedule.timeZone);
                setIsDefault(schedule.isDefault);
                setExcludeFromTeam(schedule.excludeFromTeam);
                setWeek(blocksToWeek(schedule.availability));
              }}
            >
              Discard
            </Button>
            <Button loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </div>
      ) : null}

      <div className="cal-availability">
        <section className="cal-card cal-availability__main">
          <div className="cal-availability__name">
            <TextField label="Schedule name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <hr className="cal-divider" />
          <WeeklyEditor week={week} onChange={setWeek} timeFormat={timeFormat} />
        </section>

        <aside className="cal-availability__side">
          <div className="cal-card cal-availability__panel">
            <TimezoneSelect label="Timezone" value={timeZone} onChange={setTimeZone} />
          </div>
          <div className="cal-card cal-availability__panel">
            <Switch
              checked={excludeFromTeam}
              onChange={setExcludeFromTeam}
              size="sm"
              label="Keep this schedule off team events"
              description="Team events, collective ones included, will not offer these hours — wherever you are added as a host."
            />
          </div>
          <div className="cal-card cal-availability__panel">
            <DateOverrideList
              overrides={overrides}
              onChange={(next) => void commitOverrides(next)}
              timeFormat={timeFormat}
              timeZone={timeZone}
              saving={savingOverrides}
            />
          </div>
        </aside>
      </div>
    </>
  );
}
