import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./Icon.tsx";
import "./Layout.css";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  onBack?: () => void;
}

export function PageHeader({ title, subtitle, actions, onBack }: PageHeaderProps) {
  return (
    <header className="cal-page-header">
      {onBack ? (
        <button type="button" className="cal-page-header__back" onClick={onBack} aria-label="Back">
          <Icon name="chevronLeft" size={18} />
        </button>
      ) : null}
      <div className="cal-page-header__text">
        <h1>{title}</h1>
        {subtitle ? <p className="cal-page-header__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="cal-page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function Badge({
  children,
  tone = "default",
  startIcon,
}: {
  children: ReactNode;
  tone?: "default" | "info" | "success" | "attention" | "error";
  startIcon?: IconName;
}) {
  return (
    <span className={`cal-badge cal-badge--${tone}`}>
      {startIcon ? <Icon name={startIcon} size={12} /> : null}
      {children}
    </span>
  );
}

/** How many `--cal-avatar-N-*` tint pairs `tokens.css` defines. */
const AVATAR_TINTS = 8;

/**
 * Picks one of the avatar tints from a key. Same key always lands on the same
 * tint, in either theme, on every page — so a person without a photo still has
 * a recognisable colour. Pass the most stable key available (username, email or
 * id); the display name is only a fallback, because renaming would recolour.
 */
export function avatarTint(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    // djb2-style: cheap, and spreads short keys like usernames well.
    hash = (hash * 33 + key.charCodeAt(index)) % 0xffffffff;
  }
  return (hash % AVATAR_TINTS) + 1;
}

/** First letter of the first two words — "Ada Lovelace" reads as "AL". */
export function initialsOf(name: string): string {
  const initials = name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return initials || "?";
}

export function Avatar({
  name,
  src,
  size = 32,
  colorKey,
}: {
  name: string;
  src?: string | null;
  size?: number;
  /** Stable identifier for the tint. Defaults to `name`. */
  colorKey?: string;
}) {
  // Avatar URLs are whatever a person pasted, or a provider link that may have
  // stopped resolving. A dead one must fall back to initials rather than leave
  // the browser's broken-image glyph in a list of people.
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (src && !failed) {
    return (
      <span className="cal-avatar" style={{ width: size, height: size }}>
        <img
          src={src}
          alt={name}
          loading="lazy"
          // Google and several other providers refuse hotlinked avatars when a
          // referrer is sent, which is the usual reason another person's photo
          // is the only one missing.
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }
  // Two letters crowd the small avatars used inside list rows, so those show
  // one; the tint carries the rest of the recognition.
  const initials = initialsOf(name);
  const letters = size < 24 ? initials.slice(0, 1) : initials;
  return (
    <span
      className={`cal-avatar cal-avatar--tint-${avatarTint(colorKey || name)}`}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size / 2.4)) }}
      aria-hidden="true"
      title={name}
    >
      <span>{letters}</span>
    </span>
  );
}

export function AvatarGroup({
  people,
  size = 26,
  max = 4,
}: {
  people: Array<{ name: string; avatarUrl?: string | null; colorKey?: string }>;
  size?: number;
  max?: number;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="cal-avatar-group">
      {shown.map((person, index) => (
        <span key={`${person.name}-${index}`} style={{ marginLeft: index === 0 ? 0 : -size / 3 }}>
          <Avatar
            name={person.name}
            src={person.avatarUrl}
            size={size}
            colorKey={person.colorKey}
          />
        </span>
      ))}
      {rest > 0 ? <span className="cal-avatar-group__rest">+{rest}</span> : null}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="cal-empty">
      <span className="cal-empty__icon">
        <Icon name={icon} size={22} />
      </span>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action ? <div className="cal-empty__action">{action}</div> : null}
    </div>
  );
}

export function Skeleton({
  height = 16,
  width = "100%",
  radius = 6,
  variant = "rect",
  className = "",
}: {
  height?: number | string;
  width?: number | string;
  radius?: number;
  variant?: "rect" | "text" | "circle";
  className?: string;
}) {
  const resolvedRadius = variant === "circle" ? "50%" : radius;
  const resolvedHeight = variant === "text" ? 12 : height;
  return (
    <span
      className={`cal-skeleton cal-skeleton--${variant} ${className}`}
      aria-hidden="true"
      style={{
        height: resolvedHeight,
        width: variant === "circle" ? resolvedHeight : width,
        borderRadius: resolvedRadius,
      }}
    />
  );
}

/** A paragraph-shaped placeholder; the last line is shortened so it reads as text. */
export function SkeletonText({ lines = 3, width = "100%" }: { lines?: number; width?: number | string }) {
  return (
    <span className="cal-skeleton-text" aria-hidden="true">
      {Array.from({ length: lines }, (_line, index) => (
        <Skeleton
          key={index}
          variant="text"
          width={index === lines - 1 ? "62%" : width}
        />
      ))}
    </span>
  );
}

/** Row placeholders that match the shape of `List` while data loads. */
export function SkeletonList({ rows = 3, height = 44 }: { rows?: number; height?: number }) {
  return (
    <List>
      {Array.from({ length: rows }, (_row, index) => (
        <ListRow key={index}>
          <Skeleton variant="circle" height={32} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton height={height / 4} width="40%" />
            <Skeleton height={height / 5} width="65%" />
          </div>
        </ListRow>
      ))}
    </List>
  );
}

interface TabsProps<T extends string> {
  tabs: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  variant?: "underline" | "pill";
}

export function Tabs<T extends string>({ tabs, value, onChange, variant = "underline" }: TabsProps<T>) {
  return (
    <div className={`cal-tabs cal-tabs--${variant}`} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          className={`cal-tabs__tab ${tab.value === value ? "is-active" : ""}`}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.count !== undefined ? <span className="cal-tabs__count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  ariaLabel,
}: {
  options: Array<{ value: T; label: string; icon?: IconName }>;
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  return (
    <div className={`cal-segmented cal-segmented--${size}`} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? "is-active" : ""}
          onClick={() => onChange(option.value)}
          aria-pressed={option.value === value}
        >
          {option.icon ? <Icon name={option.icon} size={14} /> : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ListRow({
  children,
  onClick,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <div
      className={`cal-list-row ${onClick ? "is-clickable" : ""} ${className}`}
      onClick={
        onClick
          ? (event) => {
              // Nested controls (switches, menus, links) own their own clicks.
              const target = event.target as HTMLElement;
              if (target.closest("button, a, input, select, textarea, [role='button']") !== null) {
                return;
              }
              onClick();
            }
          : undefined
      }
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(event) => {
        if (!onClick || event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      {children}
    </div>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <div className="cal-list">{children}</div>;
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="cal-stepper">
      {steps.map((step, index) => (
        <li key={step} className={index === current ? "is-current" : index < current ? "is-done" : ""}>
          <span className="cal-stepper__dot">{index < current ? <Icon name="check" size={12} /> : index + 1}</span>
          <span className="cal-stepper__label">{step}</span>
        </li>
      ))}
    </ol>
  );
}

export function SettingsSection({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="cal-settings-section cal-card">
      <div className="cal-settings-section__head">
        <h2>{title}</h2>
        {description ? <p className="cal-field__hint">{description}</p> : null}
      </div>
      <div className="cal-settings-section__body">{children}</div>
      {footer ? <div className="cal-settings-section__footer">{footer}</div> : null}
    </section>
  );
}
