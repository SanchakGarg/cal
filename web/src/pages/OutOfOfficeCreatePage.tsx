// Full-page "add out of office" flow — the range picker needs the room.
import { useState } from "react";
import { Button } from "../ui/Button.tsx";
import { TextArea } from "../ui/Field.tsx";
import { PageHeader } from "../ui/Layout.tsx";
import { MonthCalendar } from "../ui/Calendar.tsx";
import { Select } from "../ui/Select.tsx";
import { Alert } from "../ui/Alert.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import { formatDateISO, todayISO } from "../lib/time.ts";
import { useAuth } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";
import "./CreatePages.css";

const REASONS = ["unspecified", "vacation", "travel", "sick", "public_holiday"];

export function OutOfOfficeCreatePage() {
  const { me } = useAuth();
  const { navigate } = useRouter();
  const toast = useToast();
  const timeZone = me?.timeZone ?? "UTC";

  const [month, setMonth] = useState(() => `${todayISO(timeZone).slice(0, 7)}-01`);
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [reason, setReason] = useState("vacation");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const back = "/settings/out-of-office";

  const create = async (): Promise<void> => {
    if (!start) return;
    setSaving(true);
    try {
      await api.post("/v2/me/ooo", {
        start,
        end: end ?? start,
        reason,
        notes: notes.trim() || undefined,
      });
      toast.success("Out of office added", { description: "No slots are offered while you are away." });
      navigate(back);
    } catch (error) {
      toast.error(errorMessage(error));
      setSaving(false);
    }
  };

  return (
    <div className="cal-form-page">
      <PageHeader
        title="Add out of office"
        subtitle="Pick the first day, then the last day."
        onBack={() => navigate(back)}
      />

      <div className="cal-card cal-form-page__card">
        <div className="cal-form-page__grid">
          <MonthCalendar
            month={month}
            onMonthChange={setMonth}
            selected={start}
            timeZone={timeZone}
            onSelect={(date) => {
              // First click sets the start; the next one extends the range.
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
          <div className="cal-form-page__section">
            <Alert tone={start ? "info" : "neutral"} icon="calendar">
              {start
                ? `From ${formatDateISO(start)}${end ? ` to ${formatDateISO(end)}` : " (single day)"}`
                : "Pick a start date on the calendar."}
            </Alert>
            <Select
              label="Reason"
              value={reason}
              options={REASONS.map((value) => ({ value, label: value.replace("_", " ") }))}
              onChange={setReason}
            />
            <TextArea
              label="Notes"
              placeholder="Optional context for your team."
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>

        <div className="cal-form-page__footer">
          <Button variant="minimal" onClick={() => navigate(back)}>
            Cancel
          </Button>
          <div className="cal-spacer" />
          {start && end ? (
            <Button
              variant="secondary"
              onClick={() => {
                setStart(null);
                setEnd(null);
              }}
            >
              Clear dates
            </Button>
          ) : null}
          <Button loading={saving} disabled={!start} onClick={() => void create()}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
