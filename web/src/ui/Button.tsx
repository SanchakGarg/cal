import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon.tsx";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "minimal" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

interface Ripple {
  id: number;
  x: number;
  y: number;
  size: number;
}

/** Click feedback: a circle expanding from the pointer, cleaned up on animation end. */
function useRipples() {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const nextId = useRef(1);

  const spawn = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const id = nextId.current;
    nextId.current += 1;
    setRipples((current) => [
      ...current,
      { id, size, x: event.clientX - rect.left - size / 2, y: event.clientY - rect.top - size / 2 },
    ]);
    window.setTimeout(() => {
      setRipples((current) => current.filter((ripple) => ripple.id !== id));
    }, 520);
  }, []);

  const nodes = ripples.map((ripple) => (
    <span
      key={ripple.id}
      className="cal-btn__ripple"
      aria-hidden="true"
      style={{ left: ripple.x, top: ripple.y, width: ripple.size, height: ripple.size }}
    />
  ));

  return { spawn, nodes };
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  startIcon?: IconName;
  endIcon?: IconName;
  /** Stretches the button to the width of its container. */
  block?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  startIcon,
  endIcon,
  block = false,
  children,
  className = "",
  disabled,
  onClick,
  ...rest
}: ButtonProps) {
  const { spawn, nodes } = useRipples();
  const isDisabled = disabled || loading;

  return (
    <button
      type="button"
      className={`cal-btn cal-btn--${variant} cal-btn--${size} ${loading ? "is-loading" : ""} ${
        block ? "cal-btn--block" : ""
      } ${className}`}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      onClick={(event) => {
        if (isDisabled) return;
        spawn(event);
        onClick?.(event);
      }}
      {...rest}
    >
      {loading ? <span className="cal-btn__spinner" aria-hidden="true" /> : null}
      {startIcon && !loading ? <Icon name={startIcon} size={size === "lg" ? 18 : 16} /> : null}
      {children ? <span className="cal-btn__label">{children}</span> : null}
      {endIcon ? <Icon name={endIcon} size={size === "lg" ? 18 : 16} /> : null}
      {nodes}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function IconButton({
  icon,
  label,
  variant = "secondary",
  size = "md",
  loading = false,
  className = "",
  disabled,
  onClick,
  ...rest
}: IconButtonProps) {
  const { spawn, nodes } = useRipples();
  const isDisabled = disabled || loading;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`cal-btn cal-btn--${variant} cal-btn--${size} cal-btn--icon ${
        loading ? "is-loading" : ""
      } ${className}`}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      onClick={(event) => {
        if (isDisabled) return;
        spawn(event);
        onClick?.(event);
      }}
      {...rest}
    >
      {loading ? (
        <span className="cal-btn__spinner" aria-hidden="true" />
      ) : (
        <Icon name={icon} size={size === "sm" ? 14 : 16} />
      )}
      {nodes}
    </button>
  );
}
