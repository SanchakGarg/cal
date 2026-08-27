import { useEffect, useState } from "react";
import { NumberField } from "./Field.tsx";
import { Select } from "./Select.tsx";
import "./DurationField.css";

type Unit = "minutes" | "hours" | "days";

const PER_UNIT: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };

/**
 * The largest unit the stored value divides into evenly, so 120 minutes comes
 * back as "2 hours" rather than "120 minutes". Zero carries no information, so
 * the caller's preferred unit wins there.
 */
function unitFor(minutes: number, fallback: Unit): Unit {
  if (!minutes) return fallback;
  if (minutes % PER_UNIT.days === 0) return "days";
  if (minutes % PER_UNIT.hours === 0) return "hours";
  return "minutes";
}

interface DurationFieldProps {
  label?: string;
  hint?: string;
  /** Always in minutes — the unit is a display choice, not stored. */
  value: number;
  onChange: (minutes: number) => void;
  /** Unit shown when the value is zero. */
  defaultUnit?: Unit;
  min?: number;
}

/**
 * A duration in whichever unit suits it. The value stays in minutes on the way
 * in and out, so nothing downstream has to know a unit was ever chosen.
 */
export function DurationField({
  label,
  hint,
  value,
  onChange,
  defaultUnit = "minutes",
  min = 0,
}: DurationFieldProps) {
  const [unit, setUnit] = useState<Unit>(() => unitFor(value, defaultUnit));

  // Follow the stored value when it changes from elsewhere — a discard, or a
  // reload — but never fight the unit the person just picked.
  useEffect(() => {
    setUnit((current) => (value % PER_UNIT[current] === 0 ? current : unitFor(value, defaultUnit)));
  }, [value, defaultUnit]);

  const shown = value === 0 ? 0 : value / PER_UNIT[unit];

  return (
    <div className="cal-duration">
      <NumberField
        label={label}
        hint={hint}
        min={min}
        value={Number.isInteger(shown) ? shown : Number(shown.toFixed(2))}
        onValueChange={(next) => onChange(next === "" ? 0 : Math.round(next * PER_UNIT[unit]))}
      />
      <div className="cal-duration__unit">
        <Select
          ariaLabel={label ? `${label} unit` : "Unit"}
          value={unit}
          options={[
            { value: "minutes", label: "minutes" },
            { value: "hours", label: "hours" },
            { value: "days", label: "days" },
          ]}
          onChange={(next) => {
            // Keep the number the person sees and re-read it in the new unit,
            // which is what changing a unit visibly means.
            setUnit(next);
            onChange(Math.round(shown * PER_UNIT[next]));
          }}
        />
      </div>
    </div>
  );
}
