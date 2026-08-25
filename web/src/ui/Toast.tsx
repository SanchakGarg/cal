import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon.tsx";
import "./Toast.css";

export type ToastTone = "success" | "error" | "info" | "warning" | "loading";

export interface ToastOptions {
  /** Secondary line under the title. */
  description?: string;
  /** Milliseconds before auto-dismiss. `0` keeps the toast until dismissed. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastEntry extends ToastOptions {
  id: number;
  message: string;
  tone: ToastTone;
  leaving: boolean;
}

export interface ToastApi {
  success: (message: string, options?: ToastOptions) => number;
  error: (message: string, options?: ToastOptions) => number;
  info: (message: string, options?: ToastOptions) => number;
  warning: (message: string, options?: ToastOptions) => number;
  loading: (message: string, options?: ToastOptions) => number;
  /** Replaces an existing toast in place — used to resolve a loading toast. */
  update: (id: number, message: string, tone: ToastTone, options?: ToastOptions) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_ICON: Record<ToastTone, IconName> = {
  success: "check",
  error: "alert",
  info: "info",
  warning: "alert",
  loading: "refresh",
};

const DEFAULT_DURATION: Record<ToastTone, number> = {
  success: 4000,
  error: 6000,
  info: 4000,
  warning: 5000,
  loading: 0,
};

/** How long the leave animation runs before the entry is dropped from state. */
const EXIT_MS = 180;
const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());
  const paused = useRef(false);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      const timer = timers.current.get(id);
      if (timer) {
        window.clearTimeout(timer);
        timers.current.delete(id);
      }
      setToasts((current) =>
        current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast))
      );
      window.setTimeout(() => remove(id), EXIT_MS);
    },
    [remove]
  );

  const scheduleDismiss = useCallback(
    (id: number, duration: number) => {
      const existing = timers.current.get(id);
      if (existing) window.clearTimeout(existing);
      if (duration <= 0) {
        timers.current.delete(id);
        return;
      }
      timers.current.set(
        id,
        window.setTimeout(() => {
          // Hovering the stack pauses expiry; retry shortly instead of vanishing
          // out from under the pointer.
          if (paused.current) {
            scheduleDismiss(id, 800);
            return;
          }
          dismiss(id);
        }, duration)
      );
    },
    [dismiss]
  );

  const push = useCallback(
    (message: string, tone: ToastTone, options?: ToastOptions): number => {
      const id = nextId.current;
      nextId.current += 1;
      const entry: ToastEntry = { ...options, id, message, tone, leaving: false };
      setToasts((current) => {
        const next = [...current, entry];
        // Oldest toasts fall off the top rather than growing without bound.
        return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next;
      });
      scheduleDismiss(id, options?.duration ?? DEFAULT_DURATION[tone]);
      return id;
    },
    [scheduleDismiss]
  );

  const update = useCallback(
    (id: number, message: string, tone: ToastTone, options?: ToastOptions) => {
      setToasts((current) =>
        current.map((toast) =>
          toast.id === id ? { ...toast, ...options, message, tone, leaving: false } : toast
        )
      );
      scheduleDismiss(id, options?.duration ?? DEFAULT_DURATION[tone]);
    },
    [scheduleDismiss]
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, options) => push(message, "success", options),
      error: (message, options) => push(message, "error", options),
      info: (message, options) => push(message, "info", options),
      warning: (message, options) => push(message, "warning", options),
      loading: (message, options) => push(message, "loading", options),
      update,
      dismiss,
    }),
    [push, update, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          className="cal-toasts"
          role="region"
          aria-label="Notifications"
          onMouseEnter={() => {
            paused.current = true;
          }}
          onMouseLeave={() => {
            paused.current = false;
          }}
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`cal-toast cal-toast--${toast.tone} ${toast.leaving ? "is-leaving" : ""}`}
              role={toast.tone === "error" ? "alert" : "status"}
              aria-live={toast.tone === "error" ? "assertive" : "polite"}
            >
              <span className="cal-toast__icon">
                <Icon
                  name={TONE_ICON[toast.tone]}
                  size={15}
                  className={toast.tone === "loading" ? "cal-toast__spin" : undefined}
                />
              </span>
              <div className="cal-toast__text">
                <span className="cal-toast__title">{toast.message}</span>
                {toast.description ? (
                  <span className="cal-toast__description">{toast.description}</span>
                ) : null}
              </div>
              {toast.action ? (
                <button
                  type="button"
                  className="cal-toast__action"
                  onClick={() => {
                    toast.action?.onClick();
                    dismiss(toast.id);
                  }}
                >
                  {toast.action.label}
                </button>
              ) : null}
              <button
                type="button"
                className="cal-toast__close"
                aria-label="Dismiss notification"
                onClick={() => dismiss(toast.id)}
              >
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
