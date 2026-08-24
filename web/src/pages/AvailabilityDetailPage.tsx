import { useEffect, useState } from "react";
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

  const save = async (): Promise<void> => {
    if (!week) return;
    setSaving(true);
    try {
      const updated = await api.patch<Schedule>(`/v2/schedules/${scheduleId}`, {
        name,
        timeZone,
        isDefault,
        availability: weekToBlocks(week),
        overrides,
      });
      setSchedule(updated);
      toast.success("Availability saved");
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
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
        onBack={() => navigate("/availability")}
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
            <Button loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </>
        }
      />

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
