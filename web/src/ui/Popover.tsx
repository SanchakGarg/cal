import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./Popover.css";

interface PopoverProps {
  trigger: (props: { open: boolean; toggle: () => void; ref: (node: HTMLElement | null) => void }) => ReactNode;
  children: (props: { close: () => void }) => ReactNode;
  align?: "start" | "end";
  width?: number;
}

/** Anchored popover rendered in a portal so it escapes overflow containers. */
export function Popover({ trigger, children, align = "start", width }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, minWidth: 0 });
  const anchorRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const panelWidth = width ?? Math.max(rect.width, 200);
    const left = align === "end" ? rect.right - panelWidth : rect.left;
    setPosition({
      top: rect.bottom + 6,
      left: Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8)),
      minWidth: panelWidth,
    });
  }, [open, align, width]);

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
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

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
              className="cal-popover"
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
