"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import BatchStatusModal from "@/components/BatchStatusModal";
import DayCell from "@/components/DayCell";
import Header from "@/components/Header";
import StatusModal from "@/components/StatusModal";
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

const WORKPLACE_ORDER = [
  "K3",
  "K5",
  "Office",
  "Home",
  "Customer Site",
  "dayoff",
];

function sortWorkplaces(workplaces: Workplace[]) {
  return [...workplaces].sort((left, right) => {
    const leftIndex = WORKPLACE_ORDER.indexOf(left.name);
    const rightIndex = WORKPLACE_ORDER.indexOf(right.name);

    if (leftIndex !== -1 || rightIndex !== -1) {
      return (
        (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
        (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex)
      );
    }

    return left.name.localeCompare(right.name);
  });
}

export default function Calendar() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [workplaces, setWorkplaces] = useState<Workplace[]>([]);
  const [statuses, setStatuses] = useState<CalendarStatus[]>([]);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null);
  const [selectedStatusUserId, setSelectedStatusUserId] = useState<string | null>(
    null,
  );
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(
    () => new Set(),
  );
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

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
  const selectedDateList = useMemo(
    () => Array.from(selectedDates).sort(),
    [selectedDates],
  );

  const statusesByDate = useMemo(() => {
    return statuses.reduce<Record<string, CalendarStatus[]>>((result, status) => {
      if (!result[status.work_date]) {
        result[status.work_date] = [];
      }
      result[status.work_date].push(status);
      return result;
    }, {});
  }, [statuses]);

  const userProfile = useMemo(
    () => profiles.find((profile) => profile.id === user?.id) || null,
    [profiles, user?.id],
  );
  const isAdmin = userProfile?.role === "admin";
  const userLabel =
    userProfile?.display_name || userProfile?.email || user?.email || "";

  function handleSelectDay(day: CalendarDay, status?: CalendarStatus) {
    if (!day.isCurrentMonth) {
      return;
    }

    if (isMultiSelectMode) {
      setSelectedDates((current) => {
        const next = new Set(current);
        if (next.has(day.isoDate)) {
          next.delete(day.isoDate);
        } else {
          next.add(day.isoDate);
        }
        return next;
      });
      return;
    }

    setSelectedDay(day);
    setSelectedStatusUserId(status?.user_id || null);
    setModalError(null);
  }

  const loadMonthData = useCallback(async () => {
    if (!user || !firstMonthDate || !lastMonthDate) {
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
      supabase.from("profiles").select("*").order("display_name"),
      supabase
        .from("workplaces")
        .select("*")
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("daily_status")
        .select("*")
        .gte("work_date", firstMonthDate)
        .lte("work_date", lastMonthDate)
        .order("work_date", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);

    const errorMessages = [
      profilesResult.error
        ? `profiles: ${profilesResult.error.message}. Run supabase/add_admin_role.sql in Supabase SQL Editor.`
        : null,
      workplacesResult.error
        ? `workplaces: ${workplacesResult.error.message}. Confirm RLS allows authenticated select on active workplaces.`
        : null,
      statusesResult.error
        ? `daily_status: ${statusesResult.error.message}`
        : null,
    ].filter(Boolean);

    const nextProfiles = profilesResult.error ? [] : profilesResult.data || [];
    const nextWorkplaces = workplacesResult.error
      ? []
      : sortWorkplaces(workplacesResult.data || []);
    const profileMap = new Map(nextProfiles.map((profile) => [profile.id, profile]));
    const workplaceMap = new Map(
      nextWorkplaces.map((workplace) => [workplace.id, workplace]),
    );

    setProfiles(nextProfiles);
    setWorkplaces(nextWorkplaces);
    setStatuses(
      ((statusesResult.error ? [] : statusesResult.data || []) as DailyStatus[]).map((status) => ({
        ...status,
        profile: profileMap.get(status.user_id),
        workplace: workplaceMap.get(status.workplace_id),
      })),
    );
    setError(
      errorMessages.length > 0
        ? errorMessages.join("\n")
        : nextWorkplaces.length === 0
          ? "No active workplaces found. Run supabase/schema.sql or supabase/add_admin_role.sql in Supabase SQL Editor."
          : null,
    );
    setLoading(false);
  }, [firstMonthDate, lastMonthDate, user]);

  useEffect(() => {
    const configError = getSupabaseConfigError();
    if (configError) {
      setError(configError);
      setLoading(false);
      return;
    }

    const supabase = getSupabaseClient();

    supabase.auth.getSession().then(({ data }) => {
      if (!data.session?.user) {
        router.replace("/login");
        return;
      }
      setUser(data.session.user);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        setUser(null);
        router.replace("/login");
      } else {
        setUser(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  useEffect(() => {
    loadMonthData();
  }, [loadMonthData]);

  useEffect(() => {
    setSelectedDates(new Set());
    setIsBatchModalOpen(false);
    setBatchError(null);
  }, [currentMonth]);

  async function handleLogout() {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  async function handleSave(payload: {
    userId: string;
    workplaceId: string;
    note: string;
  }) {
    if (!user || !selectedDay) {
      return;
    }

    setSaving(true);
    setModalError(null);

    const supabase = getSupabaseClient();
    const targetUserId = isAdmin ? payload.userId : user.id;
    const targetStatus = statuses.find(
      (status) =>
        status.user_id === targetUserId &&
        status.work_date === selectedDay.isoDate,
    );

    const savePayload = {
      workplace_id: payload.workplaceId,
      note: payload.note.trim() || null,
    };

    const result = targetStatus
      ? await supabase
          .from("daily_status")
          .update(savePayload)
          .eq("id", targetStatus.id)
      : await supabase.from("daily_status").insert({
          user_id: targetUserId,
          work_date: selectedDay.isoDate,
          ...savePayload,
        });

    if (result.error) {
      setModalError(result.error.message);
      setSaving(false);
      return;
    }

    await loadMonthData();
    setSaving(false);
    setSelectedDay(null);
    setSelectedStatusUserId(null);
  }

  async function handleDelete(targetUserId: string) {
    if (!user || !selectedDay) {
      return;
    }

    const effectiveUserId = isAdmin ? targetUserId : user.id;
    const targetStatus = statuses.find(
      (status) =>
        status.user_id === effectiveUserId &&
        status.work_date === selectedDay.isoDate,
    );

    if (!targetStatus) {
      return;
    }

    setSaving(true);
    setModalError(null);

    const supabase = getSupabaseClient();
    const { error: deleteError } = await supabase
      .from("daily_status")
      .delete()
      .eq("id", targetStatus.id);

    if (deleteError) {
      setModalError(deleteError.message);
      setSaving(false);
      return;
    }

    await loadMonthData();
    setSaving(false);
    setSelectedDay(null);
    setSelectedStatusUserId(null);
  }

  async function handleBatchApply(payload: {
    userId: string;
    workplaceId: string;
    note: string;
  }) {
    if (!user || selectedDateList.length === 0) {
      return;
    }

    setSaving(true);
    setBatchError(null);

    const supabase = getSupabaseClient();
    const targetUserId = isAdmin ? payload.userId : user.id;
    const { error: upsertError } = await supabase.from("daily_status").upsert(
      selectedDateList.map((workDate) => ({
        user_id: targetUserId,
        work_date: workDate,
        workplace_id: payload.workplaceId,
        note: payload.note.trim() || null,
      })),
      { onConflict: "user_id,work_date" },
    );

    if (upsertError) {
      setBatchError(upsertError.message);
      setSaving(false);
      return;
    }

    await loadMonthData();
    setSaving(false);
    setIsBatchModalOpen(false);
    setSelectedDates(new Set());
    setIsMultiSelectMode(false);
  }

  if (loading && !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f8fb] px-4">
        <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600 shadow-soft">
          Loading...
        </div>
      </main>
    );
  }

  if (error && !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f8fb] px-4">
        <div className="max-w-lg rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          {error}
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f8fb]">
      <Header userLabel={userLabel} onLogout={handleLogout} />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <section className="mb-5 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-slate-950">
              {getMonthTitle(currentMonth)}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Click a date to manage your own workplace or day off status.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex">
            <button
              type="button"
              onClick={() => {
                setIsMultiSelectMode((value) => !value);
                setSelectedDates(new Set());
                setBatchError(null);
              }}
              className={[
                "rounded-md border px-3 py-2 text-sm font-semibold transition",
                isMultiSelectMode
                  ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
              ].join(" ")}
            >
              {isMultiSelectMode ? "Exit multi-select" : "Multi-select"}
            </button>
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

        {isMultiSelectMode ? (
          <section className="mb-4 flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-blue-900">
              Selected: {selectedDateList.length} days
            </p>
            <button
              type="button"
              onClick={() => {
                setBatchError(null);
                setIsBatchModalOpen(true);
              }}
              disabled={selectedDateList.length === 0}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              Apply to selected dates
            </button>
          </section>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

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
              <DayCell
                key={day.isoDate}
                day={day}
                statuses={
                  day.isCurrentMonth ? statusesByDate[day.isoDate] || [] : []
                }
                isMultiSelectMode={isMultiSelectMode}
                isSelected={selectedDates.has(day.isoDate)}
                onSelect={handleSelectDay}
              />
            ))}
          </div>
        </section>
      </main>

      {selectedDay && user ? (
        <StatusModal
          selectedDate={selectedDay.isoDate}
          currentUserId={user.id}
          isAdmin={isAdmin}
          selectedStatusUserId={selectedStatusUserId}
          profiles={profiles}
          statuses={statusesByDate[selectedDay.isoDate] || []}
          workplaces={workplaces}
          saving={saving}
          error={modalError}
          onClose={() => {
            setSelectedDay(null);
            setSelectedStatusUserId(null);
            setModalError(null);
          }}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      ) : null}

      {isBatchModalOpen && user ? (
        <BatchStatusModal
          selectedDateCount={selectedDateList.length}
          currentUserId={user.id}
          isAdmin={isAdmin}
          profiles={profiles}
          workplaces={workplaces}
          saving={saving}
          error={batchError}
          onClose={() => {
            setIsBatchModalOpen(false);
            setBatchError(null);
          }}
          onApply={handleBatchApply}
        />
      ) : null}
    </div>
  );
}
