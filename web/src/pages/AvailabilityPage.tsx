import { useEffect, useState } from "react";
import { Button, IconButton } from "../ui/Button.tsx";
import { ConfirmDialog } from "../ui/Dialog.tsx";
import { Badge, EmptyState, List, ListRow, PageHeader, SkeletonList } from "../ui/Layout.tsx";
import { DropdownMenu, Popover } from "../ui/Popover.tsx";
import { Icon } from "../ui/Icon.tsx";
import { useToast } from "../ui/Toast.tsx";
import { api, errorMessage } from "../lib/api.ts";
import type { Schedule } from "../lib/types.ts";
import { availabilitySummary } from "../lib/time.ts";
import { useAuth, useTimeFormat } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";

export function AvailabilityPage() {
  const { navigate } = useRouter();
  const { refresh } = useAuth();
  const timeFormat = useTimeFormat();
  const toast = useToast();
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Schedule | null>(null);

  const load = async (): Promise<void> => {
    try {
      setSchedules(await api.get<Schedule[]>("/v2/schedules"));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const duplicate = async (schedule: Schedule): Promise<void> => {
    try {
      const copy = await api.post<Schedule>("/v2/schedules", {
        name: `${schedule.name} (copy)`,
        timeZone: schedule.timeZone,
        isDefault: false,
        availability: schedule.availability,
        overrides: schedule.overrides,
      });
      toast.success("Schedule duplicated", {
        action: { label: "Open", onClick: () => navigate(`/availability/${copy.id}`) },
      });
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const remove = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/v2/schedules/${deleteTarget.id}`);
      toast.success("Schedule deleted");
      setDeleteTarget(null);
      await load();
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <>
      <PageHeader
        title="Availability"
        subtitle="Configure times when you are available for bookings."
        actions={
          <Button startIcon="plus" onClick={() => navigate("/availability/new")}>
            New
          </Button>
        }
      />

      {schedules === null ? (
        <SkeletonList rows={3} />
      ) : schedules.length === 0 ? (
        <EmptyState
          icon="clock"
          title="No schedules yet"
          description="Create a schedule to tell people when you can meet."
          action={
            <Button startIcon="plus" onClick={() => navigate("/availability/new")}>
              New schedule
            </Button>
          }
        />
      ) : (
        <List>
          {schedules.map((schedule) => (
            <ListRow key={schedule.id} onClick={() => navigate(`/availability/${schedule.id}`)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cal-row">
                  <strong>{schedule.name}</strong>
                  {schedule.isDefault ? <Badge tone="info">Default</Badge> : null}
                </div>
                <p className="cal-hint">{availabilitySummary(schedule.availability, timeFormat)}</p>
                <p className="cal-hint">
                  <Icon name="globe" size={11} /> {schedule.timeZone}
                  {schedule.overrides.length > 0
                    ? ` · ${schedule.overrides.length} date override${schedule.overrides.length === 1 ? "" : "s"}`
                    : ""}
                </p>
              </div>
              <Popover
                align="end"
                width={190}
                trigger={({ toggle, ref }) => (
                  <span
                    ref={ref as (node: HTMLSpanElement | null) => void}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle();
                    }}
                  >
                    <IconButton icon="dots" label="Schedule actions" variant="minimal" size="sm" />
                  </span>
                )}
              >
                {({ close }) => (
                  <DropdownMenu
                    close={close}
                    items={[
                      { label: "Edit", onSelect: () => navigate(`/availability/${schedule.id}`) },
                      { label: "Duplicate", onSelect: () => void duplicate(schedule) },
                      {
                        label: "Delete",
                        destructive: true,
                        disabled: schedules.length === 1,
                        onSelect: () => setDeleteTarget(schedule),
                      },
                    ]}
                  />
                )}
              </Popover>
            </ListRow>
          ))}
        </List>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
        title="Delete schedule"
        description={`"${deleteTarget?.name ?? ""}" will be removed. Event types using it fall back to your default schedule.`}
        confirmLabel="Delete"
        destructive
      />
    </>
  );
}
