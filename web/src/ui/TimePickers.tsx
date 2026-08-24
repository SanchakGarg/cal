import { useMemo } from "react";
import { Select } from "./Select.tsx";
import { formatHHMM, timeOptions, timeZoneList, zoneOffsetMinutes } from "../lib/time.ts";

interface TimeSelectProps {
  value: string;
  onChange: (value: string) => void;
  timeFormat?: 12 | 24;
  step?: number;
  size?: "sm" | "md";
  label?: string;
}

export function TimeSelect({
  value,
  onChange,
  timeFormat = 12,
  step = 15,
  size = "sm",
  label,
}: TimeSelectProps) {
  const options = useMemo(() => {
    const list = timeOptions(step);
    if (!list.includes(value)) list.push(value);
    return list
      .sort()
      .map((time) => ({ value: time, label: formatHHMM(time, timeFormat) }));
  }, [step, timeFormat, value]);

  return (
    <Select
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      size={size}
      searchable
      width={150}
    />
  );
}

interface TimezoneSelectProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  size?: "sm" | "md";
}

export function TimezoneSelect({ value, onChange, label, size = "md" }: TimezoneSelectProps) {
  const options = useMemo(() => {
    const now = new Date();
    const zones = timeZoneList();
    if (!zones.includes(value)) zones.push(value);
    return zones.map((zone) => {
      const offset = zoneOffsetMinutes(now, zone);
      const sign = offset >= 0 ? "+" : "-";
      const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
      const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
      return {
        value: zone,
        label: `${zone.replace(/_/g, " ")} (GMT${sign}${hours}:${minutes})`,
      };
    });
  }, [value]);

  return (
    <Select
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      searchable
      size={size}
      width={320}
    />
  );
}
