"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  WEEKDAYS,
  addMonths,
  buildMonthGrid,
  getMonthTitle,
  type CalendarDay,
} from "@/lib/calendar";
import {
  getSupabaseClient,
  getSupabaseConfigError,
} from "@/lib/supabaseClient";
import type {
  CalendarStatus,
  DailyStatus,
  Profile,
  Workplace,
} from "@/types/database";

function getResolvedWorkplaces(status: CalendarStatus): Workplace[] {
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

  if (resolved.length >= 2) {
    return {
      backgroundColor: "#ede9fe",
      borderColor: "#7c3aed",
      color: "#5b21b6",
    };
  }

  const color = resolved[0]?.color || "#64748b";
  return {
    backgroundColor: `${color}1A`,
    borderColor: `${color}55`,
    color,
  };
}

function sortStatuses(statuses: CalendarStatus[]) {
  const orderOf = (status: CalendarStatus) => {
    const value = status.profile?.sort_order;
    return typeof value === "number" ? value : Number.MAX_SAFE_INTEGER;
  };
  return [...statuses].sort((left, right) => {
    const delta = orderOf(left) - orderOf(right);
    if (delta !== 0) {
      return delta;
    }
    const leftName = left.profile?.display_name || "";
    const rightName = right.profile?.display_name || "";
    return leftName.localeCompare(rightName);
  });
}

function ViewDayCell({
  day,
  statuses,
}: {
  day: CalendarDay;
  statuses: CalendarStatus[];
}) {
  const sorted = useMemo(() => sortStatuses(statuses), [statuses]);

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
      className={[
        "block w-full",
        "min-h-[132px] rounded-none border bg-white p-3 text-left",
        "md:min-h-[150px]",
        day.isToday
          ? "border-blue-500 ring-2 ring-inset ring-blue-500"
          : "border-slate-200",
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
        {sorted.length === 0 ? (
          <p className="text-xs text-slate-400">No status</p>
        ) : (
          sorted.map((status) => (
            <div
              key={status.id}
              className="flex items-center gap-1.5 text-xs leading-5"
            >
              <span className="min-w-0 flex-1 truncate font-medium text-slate-700">
                {status.profile?.display_name || "Unknown"}
              </span>
              <span
                className="max-w-[120px] truncate rounded border px-1.5 py-0.5 font-semibold"
                style={getBadgeStyle(status)}
              >
                {getWorkplaceLabel(status)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function ViewPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [statuses, setStatuses] = useState<CalendarStatus[]>([]);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const monthDays = useMemo(
    () => buildMonthGrid(currentMonth),
    [currentMonth],
  );
  const currentMonthDays = useMemo(
    () => monthDays.filter((day) => day.isCurrentMonth),
    [monthDays],
  );
  const firstMonthDate = currentMonthDays[0]?.isoDate;
  const lastMonthDate = currentMonthDays[currentMonthDays.length - 1]?.isoDate;

  const statusesByDate = useMemo(() => {
    return statuses.reduce<Record<string, CalendarStatus[]>>((result, status) => {
      if (!result[status.work_date]) {
        result[status.work_date] = [];
      }
      result[status.work_date].push(status);
      return result;
    }, {});
  }, [statuses]);

  const loadData = useCallback(async () => {
    if (!firstMonthDate || !lastMonthDate) {
      return;
    }

    const configError = getSupabaseConfigError();
    if (configError) {
      setError(configError);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const supabase = getSupabaseClient();
    const [profilesResult, workplacesResult, statusesResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("display_name", { ascending: true }),
      supabase.from("workplaces").select("*").eq("is_active", true),
      supabase
        .from("daily_status")
        .select("*")
        .gte("work_date", firstMonthDate)
        .lte("work_date", lastMonthDate)
        .order("work_date", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);

    if (profilesResult.error || workplacesResult.error || statusesResult.error) {
      setError(
        profilesResult.error?.message ||
          workplacesResult.error?.message ||
          statusesResult.error?.message ||
          "Failed to load schedule. Run supabase/add_anon_read.sql so anonymous visitors can read these tables.",
      );
      setLoading(false);
      return;
    }

    const nextProfiles = profilesResult.data || [];
    const workplaces = workplacesResult.data || [];
    const profileMap = new Map(nextProfiles.map((p) => [p.id, p]));
    const workplaceMap = new Map(workplaces.map((w) => [w.id, w]));

    setProfiles(nextProfiles);
    setStatuses(
      ((statusesResult.data || []) as DailyStatus[]).map((status) => {
        const ids =
          status.workplace_ids && status.workplace_ids.length > 0
            ? status.workplace_ids
            : status.workplace_id
              ? [status.workplace_id]
              : [];
        const resolved = ids
          .map((id) => workplaceMap.get(id))
          .filter((entry): entry is Workplace => Boolean(entry));
        return {
          ...status,
          profile: profileMap.get(status.user_id),
          workplace: workplaceMap.get(status.workplace_id),
          workplaces: resolved,
        };
      }),
    );
    setLoading(false);
  }, [firstMonthDate, lastMonthDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Surface profile count in dev tools but otherwise unused here.
  void profiles;

  return (
    <div className="min-h-screen bg-[#f7f8fb]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <h1 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-700">
            Team Schedule · View
          </h1>
          <Link
            href="/login"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Login
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <section className="mb-5 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-slate-950">
              {getMonthTitle(currentMonth)}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Read-only schedule. No sign-in required.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:flex">
            <button
              type="button"
              onClick={() => setCurrentMonth((value) => addMonths(value, -1))}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setCurrentMonth(new Date())}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setCurrentMonth((value) => addMonths(value, 1))}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Next
            </button>
          </div>
        </section>

        {error ? (
          <div className="mb-4 whitespace-pre-wrap rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {loading && statuses.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600 shadow-soft">
            Loading...
          </div>
        ) : (
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft">
            <div className="hidden grid-cols-7 border-b border-slate-200 bg-slate-50 md:grid">
              {WEEKDAYS.map((weekday) => (
                <div
                  key={weekday}
                  className={[
                    "border-r border-slate-200 px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.1em] last:border-r-0",
                    weekday === "Sun"
                      ? "text-red-500"
                      : weekday === "Sat"
                        ? "text-blue-600"
                        : "text-slate-500",
                  ].join(" ")}
                >
                  {weekday}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-7">
              {monthDays.map((day) => (
                <ViewDayCell
                  key={day.isoDate}
                  day={day}
                  statuses={
                    day.isCurrentMonth ? statusesByDate[day.isoDate] || [] : []
                  }
                />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
