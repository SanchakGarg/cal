// Only the location kinds this build actually supports — no video integrations,
// because there is no provider behind them.
import { Button, IconButton } from "./Button.tsx";
import { TextField } from "./Field.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { Select } from "./Select.tsx";
import type { EventTypeLocation } from "../lib/types.ts";
import "./LocationPicker.css";

interface LocationKind {
  value: string;
  label: string;
  hint: string;
  icon: IconName;
  field?: "link" | "address" | "phone";
  placeholder?: string;
}

export const LOCATION_KINDS: LocationKind[] = [
  {
    value: "link",
    label: "Meeting link",
    hint: "You paste the room link; bookers get it with the invite.",
    icon: "video",
    field: "link",
    placeholder: "https://meet.example.com/your-room",
  },
  {
    value: "address",
    label: "In person",
    hint: "You give the address.",
    icon: "mapPin",
    field: "address",
    placeholder: "221B Baker Street, London",
  },
  {
    value: "phone",
    label: "You call the booker",
    hint: "You provide your number.",
    icon: "phone",
    field: "phone",
    placeholder: "+44 20 7946 0958",
  },
  {
    value: "attendeePhone",
    label: "Booker's phone",
    hint: "The booker enters their number when booking.",
    icon: "phone",
  },
  {
    value: "attendeeAddress",
    label: "Booker's address",
    hint: "The booker enters an address when booking.",
    icon: "mapPin",
  },
  {
    value: "attendeeDefined",
    label: "Booker decides",
    hint: "The booker types where the meeting happens.",
    icon: "user",
  },
];

export function locationKind(type: string): LocationKind | undefined {
  return LOCATION_KINDS.find((kind) => kind.value === type);
}

/** Human label for a saved location, used on the booker and in lists. */
export function locationLabel(location: EventTypeLocation | undefined): string {
  if (!location) return "Location to be confirmed";
  const kind = locationKind(location.type);
  if (!kind) return location.integration ? String(location.integration) : "Custom location";
  if (kind.field === "link") return location.link ? "Web conferencing" : kind.label;
  if (kind.field === "address") return location.address || kind.label;
  if (kind.field === "phone") return location.phone || kind.label;
  return kind.label;
}

export function locationIcon(location: EventTypeLocation | undefined): IconName {
  return locationKind(location?.type ?? "")?.icon ?? "mapPin";
}

interface LocationPickerProps {
  locations: EventTypeLocation[];
  onChange: (locations: EventTypeLocation[]) => void;
}

export function LocationPicker({ locations, onChange }: LocationPickerProps) {
  const update = (index: number, next: EventTypeLocation): void => {
    onChange(locations.map((location, locationIndex) => (locationIndex === index ? next : location)));
  };

  return (
    <div className="cal-locations">
      {locations.length === 0 ? (
        <p className="cal-hint">
          No location set — bookers see “Location to be confirmed”. Add one so they know where to
          turn up.
        </p>
      ) : null}

      {locations.map((location, index) => {
        const kind = locationKind(location.type);
        return (
          <div key={index} className="cal-location">
            <span className="cal-location__icon">
              <Icon name={kind?.icon ?? "mapPin"} size={15} />
            </span>
            <div className="cal-location__body">
              <Select
                value={location.type}
                options={LOCATION_KINDS.map((entry) => ({
                  value: entry.value,
                  label: entry.label,
                  description: entry.hint,
                }))}
                onChange={(type) => update(index, { type })}
              />
              {kind?.field ? (
                <TextField
                  placeholder={kind.placeholder}
                  value={(location[kind.field] as string | undefined) ?? ""}
                  onChange={(event) => update(index, { ...location, [kind.field as string]: event.target.value })}
                />
              ) : (
                <p className="cal-hint">{kind?.hint}</p>
              )}
            </div>
            <IconButton
              icon="trash"
              label="Remove location"
              variant="minimal"
              size="sm"
              onClick={() => onChange(locations.filter((_item, itemIndex) => itemIndex !== index))}
            />
          </div>
        );
      })}

      <Button
        variant="secondary"
        size="sm"
        startIcon="plus"
        onClick={() => onChange([...locations, { type: "link", link: "" }])}
      >
        Add a location
      </Button>
    </div>
  );
}
