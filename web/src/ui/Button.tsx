import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon.tsx";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "minimal" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  startIcon?: IconName;
  endIcon?: IconName;
  children?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  startIcon,
  endIcon,
  children,
  className = "",
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`cal-btn cal-btn--${variant} cal-btn--${size} ${loading ? "is-loading" : ""} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className="cal-btn__spinner" aria-hidden="true" /> : null}
      {startIcon && !loading ? <Icon name={startIcon} size={size === "lg" ? 18 : 16} /> : null}
      {children ? <span className="cal-btn__label">{children}</span> : null}
      {endIcon ? <Icon name={endIcon} size={size === "lg" ? 18 : 16} /> : null}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function IconButton({
  icon,
  label,
  variant = "secondary",
  size = "md",
  className = "",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`cal-btn cal-btn--${variant} cal-btn--${size} cal-btn--icon ${className}`}
      {...rest}
    >
      <Icon name={icon} size={size === "sm" ? 14 : 16} />
    </button>
  );
}
