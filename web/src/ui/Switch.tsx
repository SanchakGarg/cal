import { useId } from "react";
import "./Switch.css";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  size?: "sm" | "md";
}

export function Switch({ checked, onChange, label, description, disabled, size = "md" }: SwitchProps) {
  const id = useId();
  return (
    <div className="cal-switch-row">
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={`cal-switch cal-switch--${size} ${checked ? "is-on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="cal-switch__thumb" />
      </button>
      {label || description ? (
        <div className="cal-switch__text">
          {label ? (
            <label htmlFor={id} className="cal-switch__label">
              {label}
            </label>
          ) : null}
          {description ? <p className="cal-field__hint">{description}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
