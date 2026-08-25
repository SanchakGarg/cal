// Full-page "new schedule" flow: name it, set the week, save, land in the editor.
import { useEffect, useState } from "react";
import { Button } from "../ui/Button.tsx";
import { TextField } from "../ui/Field.tsx";
import { PageHeader } from "../ui/Layout.tsx";
import { TimezoneSelect } from "../ui/TimePickers.tsx";
import {
  WeeklyEditor,
  type WeeklySchedule,
  defaultWeek,
  weekToBlocks,
} from "../ui/AvailabilityEditor.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { Schedule } from "../lib/types.ts";
import { browserTimeZone } from "../lib/time.ts";
import { useAuth, useTimeFormat } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";
import "./CreatePages.css";

export function ScheduleCreatePage() {
  const { me, refresh } = useAuth();
  const timeFormat = useTimeFormat();
  const { navigate } = useRouter();
  const toast = useToast();

  const [name, setName] = useState("Working Hours");
  const [timeZone, setTimeZone] = useState(me?.timeZone ?? browserTimeZone());
  const [week, setWeek] = useState<WeeklySchedule>(defaultWeek());
  const [isFirst, setIsFirst] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // The first schedule a user creates becomes their default.
    void api
      .get<Schedule[]>("/v2/schedules")
      .then((schedules) => setIsFirst(schedules.length === 0))
      .catch(() => setIsFirst(false));
  }, []);

  const create = async (): Promise<void> => {
    setSaving(true);
    try {
      const created = await api.post<Schedule>("/v2/schedules", {
        name: name.trim() || "Working Hours",
        timeZone,
        isDefault: isFirst,
        availability: weekToBlocks(week),
      });
      await refresh();
      toast.success(`${created.name} created`);
      navigate(`/availability/${created.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
      setSaving(false);
    }
  };

  return (
    <div className="cal-form-page">
      <PageHeader
        title="New schedule"
        subtitle="Tell people when you can meet. You can fine-tune this later."
        onBack={() => navigate("/availability")}
      />

      <div className="cal-card cal-form-page__card">
        <div className="cal-form-page__grid">
          <TextField
            label="Name"
            required
            placeholder="Working Hours"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <TimezoneSelect label="Timezone" value={timeZone} onChange={setTimeZone} />
        </div>

        <div className="cal-form-page__section">
          <p className="cal-section-title">Weekly hours</p>
          <WeeklyEditor week={week} onChange={setWeek} timeFormat={timeFormat} />
        </div>

        <div className="cal-form-page__footer">
          <Button variant="minimal" onClick={() => navigate("/availability")}>
            Cancel
          </Button>
          <div className="cal-spacer" />
          <Button loading={saving} disabled={!name.trim()} onClick={() => void create()}>
            Create schedule
          </Button>
        </div>
      </div>
    </div>
  );
}
