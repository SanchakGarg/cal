// Booking-question editor: a typed list with a dialog for adding or editing one.
import { useEffect, useState } from "react";
import { Button, IconButton } from "./Button.tsx";
import { Dialog } from "./Dialog.tsx";
import { Checkbox, TextField } from "./Field.tsx";
import { Badge } from "./Layout.tsx";
import { Select } from "./Select.tsx";
import { Switch } from "./Switch.tsx";
import type { BookingField } from "../lib/types.ts";
import "./QuestionBuilder.css";

/** Types a user can add. System fields (name, email, …) are not in this list. */
export const QUESTION_TYPES = [
  { value: "text", label: "Short text", hint: "One line of text" },
  { value: "textarea", label: "Long text", hint: "Multi-line answer" },
  { value: "number", label: "Number", hint: "Numeric answer" },
  { value: "select", label: "Select", hint: "One option from a dropdown" },
  { value: "multiselect", label: "Multi select", hint: "Several options from a dropdown" },
  { value: "radio", label: "Radio group", hint: "One option, shown as radio buttons" },
  { value: "checkbox", label: "Checkbox group", hint: "Several options, shown as checkboxes" },
  { value: "boolean", label: "Checkbox", hint: "A single yes/no tickbox" },
  { value: "phone", label: "Phone", hint: "Phone number" },
  { value: "address", label: "Address", hint: "Postal address" },
  { value: "multiemail", label: "Multiple emails", hint: "One or more email addresses" },
  { value: "url", label: "URL", hint: "A link" },
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number]["value"];

const OPTION_TYPES = new Set(["select", "multiselect", "radio", "checkbox"]);

export const SYSTEM_FIELD_TYPES = new Set([
  "name",
  "splitName",
  "email",
  "title",
  "location",
  "notes",
  "guests",
  "rescheduleReason",
]);

const SYSTEM_LABELS: Record<string, string> = {
  name: "Your name",
  splitName: "First and last name",
  email: "Email address",
  title: "Event title",
  location: "Location",
  notes: "Additional notes",
  guests: "Add guests",
  rescheduleReason: "Reason for reschedule",
};

const slugify = (value: string): string =>
  value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function typeLabel(type: string): string {
  return QUESTION_TYPES.find((entry) => entry.value === type)?.label ?? type;
}

interface QuestionBuilderProps {
  fields: BookingField[];
  onChange: (fields: BookingField[]) => void;
}

export function QuestionBuilder({ fields, onChange }: QuestionBuilderProps) {
  const [editing, setEditing] = useState<{ index: number; field: BookingField } | null>(null);
  const [adding, setAdding] = useState(false);

  const move = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="cal-questions">
      {fields.map((field, index) => {
        const system = SYSTEM_FIELD_TYPES.has(field.type);
        return (
          <div key={`${field.slug}-${index}`} className="cal-question">
            <div className="cal-question__order">
              <button type="button" aria-label="Move up" onClick={() => move(index, -1)} disabled={index === 0}>
                ↑
              </button>
              <button
                type="button"
                aria-label="Move down"
                onClick={() => move(index, 1)}
                disabled={index === fields.length - 1}
              >
                ↓
              </button>
            </div>

            <div className="cal-question__text">
              <div className="cal-row">
                <strong>{field.label || SYSTEM_LABELS[field.type] || field.slug}</strong>
                {system ? <Badge>System</Badge> : <Badge tone="info">{typeLabel(field.type)}</Badge>}
                {field.hidden ? <Badge tone="attention">Hidden</Badge> : null}
              </div>
              <p className="cal-hint">
                {field.slug}
                {field.options?.length ? ` · ${field.options.join(", ")}` : ""}
              </p>
            </div>

            <div className="cal-row cal-question__actions">
              <Switch
                size="sm"
                checked={field.required}
                onChange={(checked) =>
                  onChange(
                    fields.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, required: checked } : item
                    )
                  )
                }
                label="Required"
              />
              {system ? null : (
                <>
                  <IconButton
                    icon="settings"
                    label="Edit question"
                    variant="minimal"
                    size="sm"
                    onClick={() => setEditing({ index, field })}
                  />
                  <IconButton
                    icon="trash"
                    label="Remove question"
                    variant="minimal"
                    size="sm"
                    onClick={() => onChange(fields.filter((_item, itemIndex) => itemIndex !== index))}
                  />
                </>
              )}
            </div>
          </div>
        );
      })}

      <Button variant="secondary" size="sm" startIcon="plus" onClick={() => setAdding(true)}>
        Add a question
      </Button>

      <QuestionDialog
        open={adding}
        onClose={() => setAdding(false)}
        existingSlugs={fields.map((field) => field.slug)}
        onSave={(field) => {
          onChange([...fields, field]);
          setAdding(false);
        }}
      />

      <QuestionDialog
        open={editing !== null}
        initial={editing?.field}
        existingSlugs={fields
          .filter((_field, index) => index !== editing?.index)
          .map((field) => field.slug)}
        onClose={() => setEditing(null)}
        onSave={(field) => {
          if (!editing) return;
          onChange(fields.map((item, index) => (index === editing.index ? field : item)));
          setEditing(null);
        }}
      />
    </div>
  );
}

function QuestionDialog({
  open,
  initial,
  existingSlugs,
  onClose,
  onSave,
}: {
  open: boolean;
  initial?: BookingField;
  existingSlugs: string[];
  onClose: () => void;
  onSave: (field: BookingField) => void;
}) {
  const [type, setType] = useState<QuestionType>("text");
  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [placeholder, setPlaceholder] = useState("");
  const [required, setRequired] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [options, setOptions] = useState<string[]>(["Option 1", "Option 2"]);

  useEffect(() => {
    if (!open) return;
    setType((initial?.type as QuestionType) ?? "text");
    setLabel(initial?.label ?? "");
    setSlug(initial?.slug ?? "");
    setSlugEdited(Boolean(initial));
    setPlaceholder(initial?.placeholder ?? "");
    setRequired(initial?.required ?? false);
    setHidden(initial?.hidden ?? false);
    setOptions(initial?.options?.length ? initial.options : ["Option 1", "Option 2"]);
  }, [open, initial]);

  const needsOptions = OPTION_TYPES.has(type);
  const effectiveSlug = slug || slugify(label);
  const duplicate = existingSlugs.includes(effectiveSlug);
  const valid =
    label.trim().length > 0 &&
    effectiveSlug.length > 0 &&
    !duplicate &&
    (!needsOptions || options.filter((option) => option.trim()).length >= 1);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? "Edit question" : "Add a question"}
      description="Bookers answer this when they book the event."
      width={520}
      footer={
        <>
          <Button variant="minimal" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() =>
              onSave({
                type,
                slug: effectiveSlug,
                label: label.trim(),
                placeholder: placeholder.trim() || null,
                required,
                hidden,
                ...(needsOptions
                  ? { options: options.map((option) => option.trim()).filter(Boolean) }
                  : {}),
              })
            }
          >
            {initial ? "Save question" : "Add question"}
          </Button>
        </>
      }
    >
      <Select
        label="Question type"
        value={type}
        options={QUESTION_TYPES.map((entry) => ({
          value: entry.value,
          label: entry.label,
          description: entry.hint,
        }))}
        onChange={(next) => setType(next)}
      />
      <TextField
        label="Label"
        placeholder="What would you like to discuss?"
        value={label}
        onChange={(event) => {
          setLabel(event.target.value);
          if (!slugEdited) setSlug(slugify(event.target.value));
        }}
      />
      <TextField
        label="Identifier"
        hint="Used as the key in the booking payload."
        error={duplicate ? "Another question already uses this identifier" : undefined}
        value={effectiveSlug}
        onChange={(event) => {
          setSlugEdited(true);
          setSlug(slugify(event.target.value));
        }}
      />
      {type === "boolean" ? null : (
        <TextField
          label="Placeholder"
          value={placeholder}
          onChange={(event) => setPlaceholder(event.target.value)}
        />
      )}

      {needsOptions ? (
        <div className="cal-questions__options">
          <p className="cal-section-title">Options</p>
          {options.map((option, index) => (
            <div key={index} className="cal-questions__option">
              <TextField
                value={option}
                placeholder={`Option ${index + 1}`}
                onChange={(event) =>
                  setOptions(options.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))
                }
              />
              <IconButton
                icon="trash"
                label="Remove option"
                variant="minimal"
                size="sm"
                disabled={options.length <= 1}
                onClick={() => setOptions(options.filter((_item, itemIndex) => itemIndex !== index))}
              />
            </div>
          ))}
          <Button
            variant="minimal"
            size="sm"
            startIcon="plus"
            onClick={() => setOptions([...options, `Option ${options.length + 1}`])}
          >
            Add option
          </Button>
        </div>
      ) : null}

      <Checkbox
        label="Required"
        description="Bookers cannot submit without answering."
        checked={required}
        onChange={(event) => setRequired(event.target.checked)}
      />
      <Checkbox
        label="Hidden"
        description="Keep the question on the event but do not show it on the booking page."
        checked={hidden}
        onChange={(event) => setHidden(event.target.checked)}
      />
    </Dialog>
  );
}
