import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton } from "./Button.tsx";
import "./Dialog.css";

/** Dialogs stack; only the outermost one restores the page scrollbar. */
let openDialogCount = 0;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}

export function Dialog({ open, onClose, title, description, children, footer, width = 480 }: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const [closing, setClosing] = useState(false);

  // Callers pass `onClose` as an inline arrow, so it is a new function on every
  // render. Reading it through a ref keeps `requestClose` — and therefore the
  // focus-trap effect below — stable; depending on it directly tore the effect
  // down and re-ran it on every keystroke, which stole focus back to the close
  // button after each letter typed into a field.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Animate out before unmounting so the dialog does not disappear abruptly.
  const closeTimer = useRef<number | undefined>(undefined);
  const requestClose = useCallback(() => {
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setClosing(false);
      onCloseRef.current();
    }, 140);
  }, []);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  useEffect(() => {
    if (!open) return;
    restoreFocusTo.current = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        requestClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      // Keep focus inside the dialog while it is modal.
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null || node === document.activeElement
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    openDialogCount += 1;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      // Prefer the first field, then the footer's leading (safe) action. The
      // close button is first in the panel but the least useful landing spot.
      const scope =
        panel.querySelector<HTMLElement>(".cal-dialog__body") ??
        panel.querySelector<HTMLElement>(".cal-dialog__footer") ??
        panel;
      scope.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }, 20);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown, true);
      openDialogCount -= 1;
      if (openDialogCount === 0) document.body.style.overflow = previousOverflow;
      restoreFocusTo.current?.focus?.();
    };
  }, [open, requestClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={`cal-dialog__backdrop ${closing ? "is-closing" : ""}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        className={`cal-dialog ${closing ? "is-closing" : ""}`}
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="cal-dialog__header">
          <div>
            <h2>{title}</h2>
            {description ? <p className="cal-field__hint">{description}</p> : null}
          </div>
          <IconButton icon="x" label="Close" variant="minimal" size="sm" onClick={requestClose} />
        </div>
        {children ? <div className="cal-dialog__body">{children}</div> : null}
        {footer ? <div className="cal-dialog__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      width={420}
      footer={
        <>
          <Button variant="minimal" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "destructive" : "primary"} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
