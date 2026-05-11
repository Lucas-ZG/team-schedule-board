"use client";

import type { CalendarDay } from "@/lib/calendar";
import type { CalendarStatus } from "@/types/database";

type DayCellProps = {
  day: CalendarDay;
  statuses: CalendarStatus[];
  isMultiSelectMode: boolean;
  isSelected: boolean;
  onSelect: (day: CalendarDay, status?: CalendarStatus) => void;
};

function getDisplayName(status: CalendarStatus) {
  return status.profile?.display_name || "Unknown";
}

function getResolvedWorkplaces(status: CalendarStatus) {
  if (status.workplaces && status.workplaces.length > 0) {
    return status.workplaces;
  }
  return status.workplace ? [status.workplace] : [];
}

function getWorkplaceLabel(status: CalendarStatus) {
  const resolved = getResolvedWorkplaces(status);
  if (resolved.length === 0) {
    return "Unknown";
  }
  return resolved
    .map((entry) => (entry.is_dayoff ? "Dayoff" : entry.name))
    .join("/");
}

function getBadgeStyle(status: CalendarStatus) {
  const resolved = getResolvedWorkplaces(status);
  const dayoff = resolved.some((entry) => entry.is_dayoff);

  if (dayoff) {
    return {
      backgroundColor: "#fee2e2",
      borderColor: "#fecaca",
      color: "#991b1b",
    };
  }

  const color = resolved[0]?.color || "#64748b";
  return {
    backgroundColor: `${color}1A`,
    borderColor: `${color}55`,
    color,
  };
}

export default function DayCell({
  day,
  statuses,
  isMultiSelectMode,
  isSelected,
  onSelect,
}: DayCellProps) {
  if (!day.isCurrentMonth) {
    return (
      <div
        aria-hidden="true"
        className="min-h-[132px] border border-slate-200 bg-slate-50 p-3 md:min-h-[150px]"
      />
    );
  }

  const dateTextClass = day.isKoreanHoliday
    ? "text-red-600"
    : day.isSunday
      ? "text-red-500"
      : day.isSaturday
        ? "text-blue-600"
        : "text-slate-700";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(day)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(day);
        }
      }}
      className={[
        "block w-full cursor-pointer",
        "min-h-[132px] rounded-none border bg-white p-3 text-left transition hover:border-blue-300 hover:bg-blue-50/40",
        "md:min-h-[150px]",
        isMultiSelectMode ? "hover:bg-blue-50" : "",
        isSelected
          ? "border-blue-500 bg-blue-50 ring-2 ring-inset ring-blue-400"
          : "border-slate-200",
        day.isToday ? "ring-2 ring-inset ring-blue-500" : "",
      ].join(" ")}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={[
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
              day.isToday ? "bg-blue-600 text-white" : dateTextClass,
            ].join(" ")}
          >
            {day.dayNumber}
          </span>
          {day.koreanHolidayName ? (
            <span className="truncate text-xs font-semibold text-red-600">
              {day.koreanHolidayName}
            </span>
          ) : null}
        </div>
      </div>

      <div className="space-y-1.5">
        {statuses.length === 0 ? (
          <p className="text-xs text-slate-400">No status</p>
        ) : (
          statuses.map((status) => {
            const overtimeHours = Number(status.overtime_hours) || 0;
            const showOvertime = status.overtime_enabled && overtimeHours > 0;
            return (
              <button
                type="button"
                key={status.id}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(day, status);
                }}
                className="block w-full text-left text-xs leading-5"
              >
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-700">
                    {getDisplayName(status)}
                  </span>
                  <span
                    className="max-w-[120px] truncate rounded border px-1.5 py-0.5 font-semibold"
                    style={getBadgeStyle(status)}
                  >
                    {getWorkplaceLabel(status)}
                  </span>
                </div>
                {showOvertime ? (
                  <span className="mt-0.5 inline-block rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-amber-700">
                    OT: {overtimeHours.toFixed(1)}h
                  </span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
