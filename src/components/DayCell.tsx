"use client";

import type { CalendarDay } from "@/lib/calendar";
import type { CalendarStatus } from "@/types/database";

type DayCellProps = {
  day: CalendarDay;
  statuses: CalendarStatus[];
  onSelect: (day: CalendarDay) => void;
};

function getDisplayName(status: CalendarStatus) {
  return status.profile?.display_name || "Unknown";
}

function getBadgeStyle(status: CalendarStatus) {
  const color = status.workplace?.color || "#64748b";

  if (status.workplace?.is_dayoff) {
    return {
      backgroundColor: "#fee2e2",
      borderColor: "#fecaca",
      color: "#991b1b",
    };
  }

  return {
    backgroundColor: `${color}1A`,
    borderColor: `${color}55`,
    color,
  };
}

export default function DayCell({ day, statuses, onSelect }: DayCellProps) {
  const dateTextClass = day.isKoreanHoliday
    ? "text-red-600"
    : day.isSunday
      ? "text-red-500"
      : day.isSaturday
        ? "text-blue-600"
        : "text-slate-700";

  return (
    <button
      type="button"
      onClick={() => onSelect(day)}
      className={[
        "min-h-[132px] rounded-none border border-slate-200 bg-white p-3 text-left transition hover:border-blue-300 hover:bg-blue-50/40",
        "md:min-h-[150px]",
        !day.isCurrentMonth ? "bg-slate-50 text-slate-400" : "",
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
        {!day.isCurrentMonth ? (
          <span className="shrink-0 text-xs font-medium text-slate-400">
            Other
          </span>
        ) : null}
      </div>

      <div className="space-y-1.5">
        {statuses.length === 0 ? (
          <p className="text-xs text-slate-400">No status</p>
        ) : (
          statuses.map((status) => (
            <div
              key={status.id}
              className="flex items-center gap-1.5 text-xs leading-5"
            >
              <span className="min-w-0 flex-1 truncate font-medium text-slate-700">
                {getDisplayName(status)}
              </span>
              <span
                className="max-w-[92px] truncate rounded border px-1.5 py-0.5 font-semibold"
                style={getBadgeStyle(status)}
              >
                {status.workplace?.name || "Unknown"}
              </span>
            </div>
          ))
        )}
      </div>
    </button>
  );
}
