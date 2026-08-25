import type { ReactElement, ReactNode } from "react";
import { cloneElement, useCallback, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./Tooltip.css";

type Side = "top" | "bottom";

interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: Side;
  /** Delay before showing, so scanning across a toolbar does not flash tips. */
  delay?: number;
}

export function Tooltip({ content, children, side = "top", delay = 250 }: TooltipProps) {
  const [position, setPosition] = useState<{ top: number; left: number; side: Side } | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const timer = useRef<number | null>(null);
  const id = useId();

  const cancel = useCallback(() => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setPosition(null);
  }, []);

  const show = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const node = anchorRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      // Flip below the anchor when there is not enough room above it.
      const resolved: Side = side === "top" && rect.top < 48 ? "bottom" : side;
      setPosition({
        side: resolved,
        top: resolved === "top" ? rect.top - 8 : rect.bottom + 8,
        left: Math.max(8, Math.min(rect.left + rect.width / 2, window.innerWidth - 8)),
      });
    }, delay);
  }, [delay, side]);

  const trigger = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node;
      const forwarded = (children as unknown as { ref?: unknown }).ref;
      if (typeof forwarded === "function") (forwarded as (value: HTMLElement | null) => void)(node);
      else if (forwarded && typeof forwarded === "object") {
        (forwarded as { current: HTMLElement | null }).current = node;
      }
    },
    "aria-describedby": position ? id : undefined,
    onMouseEnter: show,
    onMouseLeave: cancel,
    onFocus: show,
    onBlur: cancel,
  } as Record<string, unknown>);

  return (
    <>
      {trigger}
      {position
        ? createPortal(
            <span
              id={id}
              role="tooltip"
              className={`cal-tooltip cal-tooltip--${position.side}`}
              style={{ top: position.top, left: position.left }}
            >
              {content}
            </span>,
            document.body
          )
        : null}
    </>
  );
}
