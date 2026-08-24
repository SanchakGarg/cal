import { useState } from "react";
import { Button } from "../ui/Button.tsx";
import { TextArea, TextField } from "../ui/Field.tsx";
import { RadioGroup } from "../ui/Field.tsx";
import { PageHeader, Stepper } from "../ui/Layout.tsx";
import { TimezoneSelect } from "../ui/TimePickers.tsx";
import { WeeklyEditor, type WeeklySchedule, defaultWeek, weekToBlocks } from "../ui/AvailabilityEditor.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { Me, Schedule } from "../lib/types.ts";
import { browserTimeZone } from "../lib/time.ts";
import { useAuth } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";
import "./OnboardingPage.css";

const STEPS = ["Profile", "Preferences", "Availability", "Done"];

export function OnboardingPage() {
  const { me, setMe, refresh } = useAuth();
  const { navigate } = useRouter();
  const toast = useToast();

  const [step, setStep] = useState(0);
  const [name, setName] = useState(me?.name ?? "");
  const [username, setUsername] = useState(me?.username ?? "");
  const [bio, setBio] = useState(me?.bio ?? "");
  const [timeZone, setTimeZone] = useState(me?.timeZone ?? browserTimeZone());
  const [weekStart, setWeekStart] = useState<"Sunday" | "Monday">(
    (me?.weekStart as "Sunday" | "Monday") ?? "Monday"
  );
  const [timeFormat, setTimeFormat] = useState<"12" | "24">(me?.timeFormat === 24 ? "24" : "12");
  const [week, setWeek] = useState<WeeklySchedule>(defaultWeek());
  const [saving, setSaving] = useState(false);

  const skip = async (): Promise<void> => {
    setSaving(true);
    try {
      await api.patch<Me>("/v2/me", { completedOnboarding: true });
      await refresh();
      navigate("/event-types");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const saveProfile = async (): Promise<void> => {
    setSaving(true);
    try {
      const updated = await api.patch<Me>("/v2/me", { name, username, bio });
      setMe(updated);
      setStep(1);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const savePreferences = async (): Promise<void> => {
    setSaving(true);
    try {
      const updated = await api.patch<Me>("/v2/me", {
        timeZone,
        weekStart,
        timeFormat: Number(timeFormat),
      });
      setMe(updated);
      setStep(2);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const saveAvailability = async (): Promise<void> => {
    setSaving(true);
    try {
      const schedules = await api.get<Schedule[]>("/v2/schedules");
      const target = schedules.find((schedule) => schedule.isDefault) ?? schedules[0];
      const payload = {
        name: target?.name ?? "Working Hours",
        timeZone,
        isDefault: true,
        availability: weekToBlocks(week),
      };
      if (target) await api.patch(`/v2/schedules/${target.id}`, payload);
      else await api.post("/v2/schedules", payload);
      await api.patch<Me>("/v2/me", { completedOnboarding: true });
      await refresh();
      setStep(3);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cal-onboarding">
      <div className="cal-onboarding__inner">
        <div className="cal-onboarding__top">
          <Stepper steps={STEPS} current={step} />
          {step < 3 ? (
            <Button variant="minimal" size="sm" loading={saving} onClick={() => void skip()}>
              Skip for now
            </Button>
          ) : null}
        </div>

        {step === 0 ? (
          <section className="cal-card cal-onboarding__card">
            <PageHeader title="Welcome to Cal" subtitle="Tell people who they are booking." />
            <div className="cal-stack">
              <TextField label="Full name" value={name} onChange={(event) => setName(event.target.value)} />
              <TextField
                label="Username"
                prefix="cal.local/"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <TextArea
                label="About"
                placeholder="A short introduction shown on your booking page."
                value={bio}
                onChange={(event) => setBio(event.target.value)}
              />
              <Button size="lg" loading={saving} onClick={() => void saveProfile()}>
                Continue
              </Button>
            </div>
          </section>
        ) : null}

        {step === 1 ? (
          <section className="cal-card cal-onboarding__card">
            <PageHeader title="Your preferences" subtitle="We use these to show the right times." />
            <div className="cal-stack">
              <TimezoneSelect label="Timezone" value={timeZone} onChange={setTimeZone} />
              <RadioGroup
                label="Start of week"
                value={weekStart}
                onChange={(value) => setWeekStart(value)}
                options={[
                  { value: "Monday", label: "Monday" },
                  { value: "Sunday", label: "Sunday" },
                ]}
              />
              <RadioGroup
                label="Time format"
                value={timeFormat}
                onChange={(value) => setTimeFormat(value)}
                options={[
                  { value: "12", label: "12 hour", description: "9:00am" },
                  { value: "24", label: "24 hour", description: "09:00" },
                ]}
              />
              <div className="cal-row">
                <Button variant="minimal" onClick={() => setStep(0)}>
                  Back
                </Button>
                <div className="cal-spacer" />
                <Button size="lg" loading={saving} onClick={() => void savePreferences()}>
                  Continue
                </Button>
              </div>
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="cal-card cal-onboarding__card">
            <PageHeader title="Set your availability" subtitle="You can fine-tune this any time." />
            <WeeklyEditor week={week} onChange={setWeek} timeFormat={timeFormat === "24" ? 24 : 12} />
            <div className="cal-row cal-onboarding__actions">
              <Button variant="minimal" onClick={() => setStep(1)}>
                Back
              </Button>
              <div className="cal-spacer" />
              <Button size="lg" loading={saving} onClick={() => void saveAvailability()}>
                Finish
              </Button>
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <section className="cal-card cal-onboarding__card cal-onboarding__done">
            <h1>You are all set</h1>
            <p className="cal-muted">
              Your booking page is live at <strong>/{username}</strong>. Share it and start taking bookings.
            </p>
            <div className="cal-row">
              <Button size="lg" onClick={() => navigate("/event-types")}>
                Go to event types
              </Button>
              <Button size="lg" variant="secondary" onClick={() => navigate(`/${username}`)}>
                View my page
              </Button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
