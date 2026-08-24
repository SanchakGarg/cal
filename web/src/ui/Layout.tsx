import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.tsx";
import "./Layout.css";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  backHref?: string;
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

export function Avatar({
  name,
  src,
  size = 32,
}: {
  name: string;
  src?: string | null;
  size?: number;
}) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <span className="cal-avatar" style={{ width: size, height: size, fontSize: size / 2.6 }}>
      {src ? <img src={src} alt={name} /> : <span>{initials || "?"}</span>}
    </span>
  );
}

export function AvatarGroup({
  people,
  size = 26,
  max = 4,
}: {
  people: Array<{ name: string; avatarUrl?: string | null }>;
  size?: number;
  max?: number;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="cal-avatar-group">
      {shown.map((person, index) => (
        <span key={`${person.name}-${index}`} style={{ marginLeft: index === 0 ? 0 : -size / 3 }}>
          <Avatar name={person.name} src={person.avatarUrl} size={size} />
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

export function Skeleton({ height = 16, width = "100%", radius = 6 }: { height?: number; width?: number | string; radius?: number }) {
  return <span className="cal-skeleton" style={{ height, width, borderRadius: radius }} />;
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
}: {
  options: Array<{ value: T; label: string; icon?: IconName }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="cal-segmented">
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
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(event) => {
        if (onClick && (event.key === "Enter" || event.key === " ")) {
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
