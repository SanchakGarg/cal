// Renders one booking question on the public booker, driven by the field's type.
import { Checkbox, RadioGroup, TextArea, TextField } from "./Field.tsx";
import { FieldShell } from "./Field.tsx";
import { MultiSelect, Select } from "./Select.tsx";
import { Icon } from "./Icon.tsx";
import type { BookingField } from "../lib/types.ts";
import "./BookingFieldInput.css";

export function BookingFieldInput({
  field,
  value,
  onChange,
}: {
  field: BookingField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = field.label ?? field.slug;
  const options = (field.options ?? []).map((option) => ({ value: option, label: option }));

  switch (field.type) {
    case "boolean":
      return (
        <Checkbox
          label={label}
          description={field.placeholder ?? undefined}
          checked={Boolean(value)}
          required={field.required}
          onChange={(event) => onChange(event.target.checked)}
        />
      );

    case "select":
      return (
        <Select
          label={label}
          hint={field.placeholder ?? undefined}
          value={(value as string) ?? null}
          options={options}
          searchable={options.length > 8}
          onChange={onChange}
        />
      );

    case "radio":
      return (
        <RadioGroup
          label={label}
          value={(value as string) ?? ""}
          options={options}
          onChange={onChange}
        />
      );

    case "multiselect":
      return (
        <MultiSelect
          label={label}
          hint={selectionHint(field)}
          values={toArray(value)}
          options={options}
          onChange={onChange}
        />
      );

    case "checkbox":
      return (
        <FieldShell label={label} hint={selectionHint(field)} required={field.required}>
          <div className="cal-checkbox-group">
            {(field.options ?? []).map((option) => {
              const selected = toArray(value);
              const checked = selected.includes(option);
              const atMax =
                !checked &&
                field.maxSelections !== undefined &&
                selected.length >= field.maxSelections;
              return (
                <Checkbox
                  key={option}
                  label={option}
                  checked={checked}
                  disabled={atMax}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, option]
                        : selected.filter((entry) => entry !== option)
                    )
                  }
                />
              );
            })}
          </div>
        </FieldShell>
      );

    case "rating": {
      const max = field.maxRating ?? 5;
      const current = Number(value) || 0;
      return (
        <FieldShell label={label} hint={field.placeholder ?? undefined} required={field.required}>
          <div className="cal-rating" role="radiogroup" aria-label={label}>
            {Array.from({ length: max }, (_star, index) => index + 1).map((score) => (
              <button
                key={score}
                type="button"
                role="radio"
                aria-checked={current === score}
                aria-label={`${score} of ${max}`}
                className={`cal-rating__star ${score <= current ? "is-on" : ""}`}
                onClick={() => onChange(score === current ? null : score)}
              >
                <Icon name="check" size={15} />
                <span>{score}</span>
              </button>
            ))}
          </div>
        </FieldShell>
      );
    }

    case "textarea":
    case "address":
      return (
        <TextArea
          label={label}
          placeholder={field.placeholder ?? undefined}
          required={field.required}
          value={(value as string) ?? ""}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case "multiemail":
      return (
        <TextField
          label={label}
          hint="Comma separated email addresses"
          placeholder={field.placeholder ?? undefined}
          required={field.required}
          value={toArray(value).join(", ")}
          onChange={(event) =>
            onChange(
              event.target.value
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean)
            )
          }
        />
      );

    default:
      return (
        <TextField
          label={label}
          placeholder={field.placeholder ?? undefined}
          required={field.required}
          type={inputType(field.type)}
          value={(value as string) ?? ""}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

function selectionHint(field: BookingField): string | undefined {
  const { minSelections: min, maxSelections: max } = field;
  if (min && max) return `Choose between ${min} and ${max} options`;
  if (min) return `Choose at least ${min} option${min === 1 ? "" : "s"}`;
  if (max) return `Choose up to ${max} option${max === 1 ? "" : "s"}`;
  return undefined;
}

function inputType(type: string): string {
  switch (type) {
    case "number":
      return "number";
    case "url":
      return "url";
    case "phone":
      return "tel";
    case "date":
      return "date";
    case "time":
      return "time";
    default:
      return "text";
  }
}
