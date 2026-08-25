import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.tsx";
import "./Alert.css";

export type AlertTone = "info" | "success" | "warning" | "error" | "neutral";

const TONE_ICON: Record<AlertTone, IconName> = {
  info: "info",
  success: "check",
  warning: "alert",
  error: "alert",
  neutral: "info",
};

/** Inline callout for context that should stay on the page, not in a toast. */
export function Alert({
  tone = "info",
  title,
  children,
  action,
  icon,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className={`cal-alert cal-alert--${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span className="cal-alert__icon">
        <Icon name={icon ?? TONE_ICON[tone]} size={15} />
      </span>
      <div className="cal-alert__text">
        {title ? <strong className="cal-alert__title">{title}</strong> : null}
        {children ? <div className="cal-alert__body">{children}</div> : null}
      </div>
      {action ? <div className="cal-alert__action">{action}</div> : null}
    </div>
  );
}
