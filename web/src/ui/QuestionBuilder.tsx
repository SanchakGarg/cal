// Booking-question editor. Questions expand inline instead of opening a dialog,
// so the whole form stays visible while a question is being written.
import { useEffect, useMemo, useState } from "react";
import { Button, IconButton } from "./Button.tsx";
import { Checkbox, NumberField, TextField } from "./Field.tsx";
import { Badge } from "./Layout.tsx";
import { Select } from "./Select.tsx";
import { Switch } from "./Switch.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import type { BookingField } from "../lib/types.ts";
import "./QuestionBuilder.css";

interface QuestionTypeMeta {
  value: string;
  label: string;
  hint: string;
  icon: IconName;
  group: "Text" | "Choice" | "Contact" | "Date & rating";
}

/** Types a user can add. System fields (name, email, …) are not in this list. */
export const QUESTION_TYPES = [
  { value: "text", label: "Short text", hint: "One line of text", icon: "link", group: "Text" },
  { value: "textarea", label: "Long text", hint: "Multi-line answer", icon: "link", group: "Text" },
  { value: "number", label: "Number", hint: "Numeric answer", icon: "link", group: "Text" },
  { value: "url", label: "URL", hint: "A link", icon: "external", group: "Text" },
  {
    value: "select",
    label: "Dropdown",
    hint: "Pick one option from a dropdown list",
    icon: "chevronDown",
    group: "Choice",
  },
  {
    value: "multiselect",
    label: "Multi-select dropdown",
    hint: "Pick several options from a dropdown list",
    icon: "chevronDown",
    group: "Choice",
  },
  {
    value: "radio",
    label: "Multiple choice",
    hint: "Pick one option, shown as radio buttons",
    icon: "check",
    group: "Choice",
  },
  {
    value: "checkbox",
    label: "Checkboxes",
    hint: "Tick any number of options",
    icon: "check",
    group: "Choice",
  },
  {
    value: "boolean",
    label: "Single checkbox",
    hint: "One yes/no tickbox, good for consent",
    icon: "check",
    group: "Choice",
  },
  { value: "phone", label: "Phone", hint: "Phone number", icon: "phone", group: "Contact" },
  { value: "address", label: "Address", hint: "Postal address", icon: "mapPin", group: "Contact" },
  {
    value: "multiemail",
    label: "Multiple emails",
    hint: "One or more email addresses",
    icon: "user",
    group: "Contact",
  },
  { value: "date", label: "Date", hint: "A calendar date", icon: "calendar", group: "Date & rating" },
  { value: "time", label: "Time", hint: "A time of day", icon: "clock", group: "Date & rating" },
  {
    value: "rating",
    label: "Rating",
    hint: "A star rating between 1 and the maximum",
    icon: "check",
    group: "Date & rating",
  },
] as const satisfies readonly QuestionTypeMeta[];

export type QuestionType = (typeof QUESTION_TYPES)[number]["value"];

/** Types whose answers come from a fixed option list. */
const OPTION_TYPES = new Set<string>(["select", "multiselect", "radio", "checkbox"]);
/** Option types where more than one answer can be selected. */
const MULTI_TYPES = new Set<string>(["multiselect", "checkbox"]);
/** Types with no useful placeholder. */
const NO_PLACEHOLDER_TYPES = new Set<string>([
  "boolean",
  "rating",
  "select",
  "multiselect",
  "radio",
  "checkbox",
]);

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

function typeMeta(type: string): QuestionTypeMeta | undefined {
  return QUESTION_TYPES.find((entry) => entry.value === type);
}

function blankQuestion(): BookingField {
  return {
    type: "text",
    slug: "",
    label: "",
    placeholder: null,
    required: false,
    hidden: false,
  };
}

/** Trims a field down to the keys its type actually uses. */
function normalize(field: BookingField): BookingField {
  const next: BookingField = {
    type: field.type,
    slug: field.slug,
    label: (field.label ?? "").trim() || null,
    placeholder: NO_PLACEHOLDER_TYPES.has(field.type)
      ? null
      : (field.placeholder ?? "").trim() || null,
    required: field.required,
    hidden: field.hidden,
  };
  if (OPTION_TYPES.has(field.type)) {
    next.options = (field.options ?? []).map((option) => option.trim()).filter(Boolean);
  }
  if (MULTI_TYPES.has(field.type)) {
    if (field.minSelections) next.minSelections = field.minSelections;
    if (field.maxSelections) next.maxSelections = field.maxSelections;
  }
  if (field.type === "rating") next.maxRating = field.maxRating ?? 5;
  return next;
}

function problemWith(field: BookingField, otherSlugs: string[]): string | null {
  if (!(field.label ?? "").trim()) return "Give the question a label";
  if (!field.slug) return "Give the question an identifier";
  if (otherSlugs.includes(field.slug)) return "Another question already uses this identifier";
  if (OPTION_TYPES.has(field.type)) {
    const options = (field.options ?? []).map((option) => option.trim()).filter(Boolean);
    if (options.length < 2) return "Add at least two options";
    if (new Set(options).size !== options.length) return "Options must be unique";
  }
  if (MULTI_TYPES.has(field.type)) {
    const min = field.minSelections ?? 0;
    const max = field.maxSelections ?? 0;
    if (min && max && min > max) return "Minimum selections cannot exceed the maximum";
    const optionCount = (field.options ?? []).filter((option) => option.trim()).length;
    if (min > optionCount) return "Minimum selections is higher than the number of options";
  }
  return null;
}

interface QuestionBuilderProps {
  fields: BookingField[];
  onChange: (fields: BookingField[]) => void;
}

export function QuestionBuilder({ fields, onChange }: QuestionBuilderProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<BookingField | null>(null);

  const otherSlugs = useMemo(
    () => fields.filter((_field, index) => index !== editingIndex).map((field) => field.slug),
    [fields, editingIndex]
  );

  const move = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
    if (editingIndex === index) setEditingIndex(target);
    else if (editingIndex === target) setEditingIndex(index);
  };

  const startAdding = (): void => {
    setDraft(blankQuestion());
    setEditingIndex(fields.length);
  };

  const startEditing = (index: number): void => {
    setDraft({ ...fields[index] });
    setEditingIndex(index);
  };

  const cancelEditing = (): void => {
    setDraft(null);
    setEditingIndex(null);
  };

  const commit = (): void => {
    if (!draft || editingIndex === null) return;
    const cleaned = normalize(draft);
    const next = [...fields];
    if (editingIndex >= fields.length) next.push(cleaned);
    else next[editingIndex] = cleaned;
    onChange(next);
    cancelEditing();
  };

  const duplicate = (index: number): void => {
    const source = fields[index];
    const used = new Set(fields.map((field) => field.slug));
    let slug = `${source.slug}-copy`;
    let counter = 2;
    while (used.has(slug)) {
      slug = `${source.slug}-copy-${counter}`;
      counter += 1;
    }
    const next = [...fields];
    next.splice(index + 1, 0, { ...source, slug, label: `${source.label ?? source.slug} (copy)` });
    onChange(next);
  };

  const addingNew = editingIndex !== null && editingIndex >= fields.length;

  return (
    <div className="cal-questions">
      {fields.map((field, index) => {
        const system = SYSTEM_FIELD_TYPES.has(field.type);
        if (editingIndex === index && draft) {
          return (
            <QuestionEditor
              key={`editor-${index}`}
              draft={draft}
              otherSlugs={otherSlugs}
              onDraftChange={setDraft}
              onCancel={cancelEditing}
              onSave={commit}
              isNew={false}
            />
          );
        }
        return (
          <div key={`${field.slug}-${index}`} className="cal-question">
            <div className="cal-question__order">
              <button
                type="button"
                aria-label={`Move ${field.label || field.slug} up`}
                onClick={() => move(index, -1)}
                disabled={index === 0}
              >
                <Icon name="chevronUp" size={13} />
              </button>
              <button
                type="button"
                aria-label={`Move ${field.label || field.slug} down`}
                onClick={() => move(index, 1)}
                disabled={index === fields.length - 1}
              >
                <Icon name="chevronDown" size={13} />
              </button>
            </div>

            <div className="cal-question__text">
              <div className="cal-row">
                <strong>{field.label || SYSTEM_LABELS[field.type] || field.slug}</strong>
                {system ? (
                  <Badge>System</Badge>
                ) : (
                  <Badge tone="info" startIcon={typeMeta(field.type)?.icon}>
                    {typeMeta(field.type)?.label ?? field.type}
                  </Badge>
                )}
                {field.hidden ? <Badge tone="attention">Hidden</Badge> : null}
              </div>
              <p className="cal-hint">{describe(field)}</p>
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
                    onClick={() => startEditing(index)}
                  />
                  <IconButton
                    icon="copy"
                    label="Duplicate question"
                    variant="minimal"
                    size="sm"
                    onClick={() => duplicate(index)}
                  />
                  <IconButton
                    icon="trash"
                    label="Remove question"
                    variant="minimal"
                    size="sm"
                    onClick={() => {
                      onChange(fields.filter((_item, itemIndex) => itemIndex !== index));
                      if (editingIndex !== null && editingIndex >= index) cancelEditing();
                    }}
                  />
                </>
              )}
            </div>
          </div>
        );
      })}

      {addingNew && draft ? (
        <QuestionEditor
          draft={draft}
          otherSlugs={otherSlugs}
          onDraftChange={setDraft}
          onCancel={cancelEditing}
          onSave={commit}
          isNew
        />
      ) : (
        <Button variant="secondary" size="sm" startIcon="plus" onClick={startAdding}>
          Add a question
        </Button>
      )}
    </div>
  );
}

function describe(field: BookingField): string {
  const parts = [field.slug];
  if (field.options?.length) parts.push(field.options.join(", "));
  if (field.minSelections || field.maxSelections) {
    const min = field.minSelections ?? 0;
    const max = field.maxSelections;
    parts.push(max ? `pick ${min || 1}–${max}` : `pick at least ${min}`);
  }
  if (field.type === "rating") parts.push(`1–${field.maxRating ?? 5}`);
  return parts.join(" · ");
}

function QuestionEditor({
  draft,
  otherSlugs,
  onDraftChange,
  onCancel,
  onSave,
  isNew,
}: {
  draft: BookingField;
  otherSlugs: string[];
  onDraftChange: (field: BookingField) => void;
  onCancel: () => void;
  onSave: () => void;
  isNew: boolean;
}) {
  // Once the identifier has been typed by hand, stop deriving it from the label.
  const [slugLocked, setSlugLocked] = useState(Boolean(draft.slug));

  useEffect(() => {
    setSlugLocked(Boolean(draft.slug));
    // Only re-evaluate when a different question opens, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew]);

  const set = (patch: Partial<BookingField>): void => onDraftChange({ ...draft, ...patch });

  const needsOptions = OPTION_TYPES.has(draft.type);
  const isMulti = MULTI_TYPES.has(draft.type);
  const options = draft.options ?? [];
  const problem = problemWith(draft, otherSlugs);

  const setOptions = (next: string[]): void => set({ options: next });

  const moveOption = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    if (target < 0 || target >= options.length) return;
    const next = [...options];
    [next[index], next[target]] = [next[target], next[index]];
    setOptions(next);
  };

  return (
    <div className="cal-question-editor">
      <div className="cal-question-editor__head">
        <strong>{isNew ? "New question" : "Edit question"}</strong>
        <p className="cal-hint">Bookers answer this when they book the event.</p>
      </div>

      <div className="cal-question-editor__grid">
        <Select
          label="Question type"
          value={draft.type}
          searchable
          options={QUESTION_TYPES.map((entry) => ({
            value: entry.value as string,
            label: `${entry.group} · ${entry.label}`,
            description: entry.hint,
          }))}
          onChange={(next) => {
            const patch: Partial<BookingField> = { type: next };
            // Switching into an option type seeds a usable starting list.
            if (OPTION_TYPES.has(next) && (draft.options ?? []).length < 2) {
              patch.options = ["Option 1", "Option 2"];
            }
            if (next === "rating" && !draft.maxRating) patch.maxRating = 5;
            set(patch);
          }}
        />
        <TextField
          label="Label"
          placeholder="What would you like to discuss?"
          value={draft.label ?? ""}
          onChange={(event) => {
            const label = event.target.value;
            set(slugLocked ? { label } : { label, slug: slugify(label) });
          }}
        />
      </div>

      <TextField
        label="Identifier"
        hint="Used as the key in the booking payload and in webhooks."
        value={draft.slug}
        onChange={(event) => {
          setSlugLocked(true);
          set({ slug: slugify(event.target.value) });
        }}
      />

      {NO_PLACEHOLDER_TYPES.has(draft.type) ? null : (
        <TextField
          label="Placeholder"
          value={draft.placeholder ?? ""}
          onChange={(event) => set({ placeholder: event.target.value })}
        />
      )}

      {draft.type === "rating" ? (
        <NumberField
          label="Highest rating"
          min={2}
          max={10}
          value={draft.maxRating ?? 5}
          onValueChange={(next) => set({ maxRating: next === "" ? 5 : next })}
        />
      ) : null}

      {needsOptions ? (
        <div className="cal-questions__options">
          <p className="cal-section-title">Options</p>
          {options.map((option, index) => (
            <div key={index} className="cal-questions__option">
              <div className="cal-questions__option-order">
                <button
                  type="button"
                  aria-label={`Move option ${index + 1} up`}
                  onClick={() => moveOption(index, -1)}
                  disabled={index === 0}
                >
                  <Icon name="chevronUp" size={12} />
                </button>
                <button
                  type="button"
                  aria-label={`Move option ${index + 1} down`}
                  onClick={() => moveOption(index, 1)}
                  disabled={index === options.length - 1}
                >
                  <Icon name="chevronDown" size={12} />
                </button>
              </div>
              <TextField
                value={option}
                placeholder={`Option ${index + 1}`}
                onChange={(event) =>
                  setOptions(
                    options.map((item, itemIndex) => (itemIndex === index ? event.target.value : item))
                  )
                }
              />
              <IconButton
                icon="trash"
                label={`Remove option ${index + 1}`}
                variant="minimal"
                size="sm"
                disabled={options.length <= 2}
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

      {isMulti ? (
        <div className="cal-question-editor__grid">
          <NumberField
            label="Minimum selections"
            hint="Leave empty for no minimum."
            min={0}
            max={options.length}
            value={draft.minSelections ?? ""}
            onValueChange={(next) => set({ minSelections: next === "" ? undefined : next })}
          />
          <NumberField
            label="Maximum selections"
            hint="Leave empty to allow every option."
            min={1}
            max={options.length}
            value={draft.maxSelections ?? ""}
            onValueChange={(next) => set({ maxSelections: next === "" ? undefined : next })}
          />
        </div>
      ) : null}

      <Checkbox
        label="Required"
        description="Bookers cannot submit without answering."
        checked={draft.required}
        onChange={(event) => set({ required: event.target.checked })}
      />
      <Checkbox
        label="Hidden"
        description="Keep the question on the event but do not show it on the booking page."
        checked={draft.hidden}
        onChange={(event) => set({ hidden: event.target.checked })}
      />

      {problem ? <p className="cal-field__error">{problem}</p> : null}

      <div className="cal-row cal-question-editor__actions">
        <div className="cal-spacer" />
        <Button variant="minimal" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={problem !== null} onClick={onSave}>
          {isNew ? "Add question" : "Save question"}
        </Button>
      </div>
    </div>
  );
}
