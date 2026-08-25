import type { ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./Popover.css";

interface PopoverProps {
  trigger: (props: { open: boolean; toggle: () => void; ref: (node: HTMLElement | null) => void }) => ReactNode;
  children: (props: { close: () => void }) => ReactNode;
  align?: "start" | "end";
  width?: number;
}

interface Position {
  top: number;
  left: number;
  minWidth: number;
  placement: "bottom" | "top";
}

const GAP = 6;
const EDGE = 8;
const MAX_HEIGHT = 320;

/** Anchored popover rendered in a portal so it escapes overflow containers. */
export function Popover({ trigger, children, align = "start", width }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position>({
    top: 0,
    left: 0,
    minWidth: 0,
    placement: "bottom",
  });
  const anchorRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const panelWidth = width ?? Math.max(rect.width, 200);
    const panelHeight = Math.min(panelRef.current?.offsetHeight ?? MAX_HEIGHT, MAX_HEIGHT);
    const spaceBelow = window.innerHeight - rect.bottom;
    // Flip above the anchor when the panel would run off the bottom of the viewport.
    const placement: Position["placement"] =
      spaceBelow < panelHeight + GAP + EDGE && rect.top > spaceBelow ? "top" : "bottom";
    const left = align === "end" ? rect.right - panelWidth : rect.left;
    setPosition({
      placement,
      top: placement === "bottom" ? rect.bottom + GAP : Math.max(EDGE, rect.top - panelHeight - GAP),
      left: Math.max(EDGE, Math.min(left, window.innerWidth - panelWidth - EDGE)),
      minWidth: panelWidth,
    });
  }, [align, width]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    // Anything that moves the anchor must move the panel with it, otherwise the
    // menu detaches and floats over unrelated content.
    const onReflow = (): void => place();

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, place]);

  return (
    <>
      {trigger({
        open,
        toggle: () => setOpen((value) => !value),
        ref: (node) => {
          anchorRef.current = node;
        },
      })}
      {open
        ? createPortal(
            <div
              ref={panelRef}
              className={`cal-popover cal-popover--${position.placement}`}
              style={{ top: position.top, left: position.left, minWidth: position.minWidth }}
              role="dialog"
            >
              {children({ close: () => setOpen(false) })}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

interface DropdownItem {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export function DropdownMenu({ items, close }: { items: DropdownItem[]; close: () => void }) {
  return (
    <div className="cal-menu" role="menu">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className={`cal-menu__item ${item.destructive ? "is-destructive" : ""}`}
          onClick={() => {
            item.onSelect();
            close();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
