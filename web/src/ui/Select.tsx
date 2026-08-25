import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon.tsx";
import { FieldShell } from "./Field.tsx";
import { Popover } from "./Popover.tsx";
import "./Select.css";

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  description?: string;
}

interface SelectProps<T extends string | number> {
  value: T | null;
  options: Array<SelectOption<T>>;
  onChange: (value: T) => void;
  label?: string;
  hint?: string;
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
  size?: "sm" | "md";
  width?: number;
}

/** Listbox built from scratch: typeahead filter, arrow keys, portal popover. */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  hint,
  placeholder = "Select…",
  searchable = false,
  disabled = false,
  size = "md",
  width,
}: SelectProps<T>) {
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const selected = options.find((option) => option.value === value) ?? null;
  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const needle = search.trim().toLowerCase();
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, search]);

  // Keep the keyboard cursor visible in long lists (time zones, durations).
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.children[activeIndex] as HTMLElement | undefined;
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const moveActive = (delta: number): void => {
    setActiveIndex((index) => Math.max(0, Math.min(index + delta, filtered.length - 1)));
  };

  return (
    <FieldShell label={label} hint={hint}>
      <Popover
        width={width}
        trigger={({ open, toggle, ref }) => (
          <button
            type="button"
            ref={ref as (node: HTMLButtonElement | null) => void}
            className={`cal-select cal-select--${size} ${open ? "is-open" : ""}`}
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => {
              toggle();
              setSearch("");
              setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
              requestAnimationFrame(() => searchRef.current?.focus());
            }}
          >
            <span className={selected ? "" : "cal-select__placeholder"}>
              {selected ? selected.label : placeholder}
            </span>
            <Icon name="chevronDown" size={14} />
          </button>
        )}
      >
        {({ close }) => (
          <div
            className="cal-select__panel"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveActive(1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                moveActive(-1);
              } else if (event.key === "Enter") {
                event.preventDefault();
                const option = filtered[activeIndex];
                if (option) {
                  onChange(option.value);
                  close();
                }
              }
            }}
          >
            {searchable ? (
              <input
                ref={searchRef}
                className="cal-select__search"
                placeholder="Search…"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setActiveIndex(0);
                }}
              />
            ) : null}
            {filtered.length === 0 ? <p className="cal-select__empty">No matches</p> : null}
            <div className="cal-select__list" role="listbox" ref={listRef}>
              {filtered.map((option, index) => (
                <button
                  key={String(option.value)}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className={`cal-select__option ${index === activeIndex ? "is-active" : ""} ${
                    option.value === value ? "is-selected" : ""
                  }`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    onChange(option.value);
                    close();
                  }}
                >
                  <span>
                    <span className="cal-select__option-label">{option.label}</span>
                    {option.description ? (
                      <span className="cal-select__option-hint">{option.description}</span>
                    ) : null}
                  </span>
                  {option.value === value ? <Icon name="check" size={14} /> : null}
                </button>
              ))}
            </div>
          </div>
        )}
      </Popover>
    </FieldShell>
  );
}

interface MultiSelectProps<T extends string | number> {
  values: T[];
  options: Array<SelectOption<T>>;
  onChange: (values: T[]) => void;
  label?: string;
  hint?: string;
  placeholder?: string;
}

export function MultiSelect<T extends string | number>({
  values,
  options,
  onChange,
  label,
  hint,
  placeholder = "Select…",
}: MultiSelectProps<T>) {
  const selected = options.filter((option) => values.includes(option.value));
  return (
    <FieldShell label={label} hint={hint}>
      <Popover
        trigger={({ open, toggle, ref }) => (
          <button
            type="button"
            ref={ref as (node: HTMLButtonElement | null) => void}
            className={`cal-select cal-select--md ${open ? "is-open" : ""}`}
            onClick={toggle}
          >
            <span className={selected.length ? "" : "cal-select__placeholder"}>
              {selected.length ? selected.map((option) => option.label).join(", ") : placeholder}
            </span>
            <Icon name="chevronDown" size={14} />
          </button>
        )}
      >
        {() => (
          <div className="cal-select__list" role="listbox" aria-multiselectable="true">
            {options.map((option) => {
              const isSelected = values.includes(option.value);
              return (
                <button
                  key={String(option.value)}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`cal-select__option ${isSelected ? "is-selected" : ""}`}
                  onClick={() =>
                    onChange(
                      isSelected
                        ? values.filter((value) => value !== option.value)
                        : [...values, option.value]
                    )
                  }
                >
                  <span className="cal-select__option-label">{option.label}</span>
                  {isSelected ? <Icon name="check" size={14} /> : null}
                </button>
              );
            })}
          </div>
        )}
      </Popover>
    </FieldShell>
  );
}
