import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { useEffect, useId, useState } from "react";
import "./Field.css";

interface FieldShellProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  addOn?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}

export function FieldShell({ label, hint, error, required, children, htmlFor }: FieldShellProps) {
  return (
    <div className="cal-field">
      {label ? (
        <label className="cal-field__label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="cal-field__required">*</span> : null}
        </label>
      ) : null}
      {children}
      {hint && !error ? <p className="cal-field__hint">{hint}</p> : null}
      {error ? <p className="cal-field__error">{error}</p> : null}
    </div>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  hint?: string;
  error?: string;
  prefix?: string;
  suffix?: ReactNode;
}

export function TextField({ label, hint, error, prefix, suffix, className = "", ...rest }: TextFieldProps) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} error={error} required={rest.required} htmlFor={id}>
      <div className={`cal-input-group ${error ? "has-error" : ""}`}>
        {prefix ? <span className="cal-input-group__prefix">{prefix}</span> : null}
        <input id={id} className={`cal-input ${className}`} {...rest} />
        {suffix ? <span className="cal-input-group__suffix">{suffix}</span> : null}
      </div>
    </FieldShell>
  );
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function TextArea({ label, hint, error, className = "", ...rest }: TextAreaProps) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} error={error} required={rest.required} htmlFor={id}>
      <textarea id={id} className={`cal-input cal-textarea ${error ? "has-error" : ""} ${className}`} {...rest} />
    </FieldShell>
  );
}

interface NumberFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> {
  label?: string;
  hint?: string;
  value: number | "";
  onValueChange: (value: number | "") => void;
  suffix?: string;
}

export function NumberField({ label, hint, value, onValueChange, suffix, ...rest }: NumberFieldProps) {
  const id = useId();
  // The box keeps its own text while it is being edited. Callers almost always
  // substitute a number for an empty value ("" -> 0), and binding the input
  // straight to that made the field impossible to clear: deleting the last
  // digit put the substitute straight back and the caret sat after it. Local
  // text lets the box be empty mid-edit; blur resyncs to whatever the caller
  // settled on.
  const [text, setText] = useState(value === "" ? "" : String(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (editing) return;
    setText(value === "" ? "" : String(value));
  }, [value, editing]);

  return (
    <FieldShell label={label} hint={hint} htmlFor={id}>
      <div className="cal-input-group">
        <input
          id={id}
          type="number"
          className="cal-input"
          value={text}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            setEditing(false);
            setText(value === "" ? "" : String(value));
          }}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            onValueChange(next === "" ? "" : Number(next));
          }}
          {...rest}
        />
        {suffix ? <span className="cal-input-group__suffix">{suffix}</span> : null}
      </div>
    </FieldShell>
  );
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  description?: string;
}

export function Checkbox({ label, description, className = "", ...rest }: CheckboxProps) {
  const id = useId();
  return (
    <div className={`cal-checkbox ${className}`}>
      <input id={id} type="checkbox" {...rest} />
      <div>
        <label htmlFor={id}>{label}</label>
        {description ? <p className="cal-field__hint">{description}</p> : null}
      </div>
    </div>
  );
}

interface RadioGroupProps<T extends string> {
  label?: string;
  value: T;
  options: Array<{ value: T; label: string; description?: string }>;
  onChange: (value: T) => void;
  name?: string;
}

export function RadioGroup<T extends string>({ label, value, options, onChange, name }: RadioGroupProps<T>) {
  const groupName = useId();
  return (
    <FieldShell label={label}>
      <div className="cal-radio-group">
        {options.map((option) => (
          <label
            key={option.value}
            className={`cal-radio ${value === option.value ? "is-selected" : ""}`}
          >
            <input
              type="radio"
              name={name ?? groupName}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>
              <span className="cal-radio__label">{option.label}</span>
              {option.description ? <span className="cal-field__hint">{option.description}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </FieldShell>
  );
}
