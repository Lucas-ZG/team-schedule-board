"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
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

const WORKPLACE_ORDER = ["K3", "K5", "Office", "ITEK", "Customer Site", "Dayoff"];

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const monthDays = useMemo(
    () => buildMonthGrid(currentMonth),
    [currentMonth],
  );
  const firstGridDate = monthDays[0]?.isoDate;
  const lastGridDate = monthDays[monthDays.length - 1]?.isoDate;

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
  const userLabel = userProfile?.display_name || user?.email || "";

  const loadMonthData = useCallback(async () => {
    if (!user || !firstGridDate || !lastGridDate) {
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
        .gte("work_date", firstGridDate)
        .lte("work_date", lastGridDate)
        .order("work_date", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);

    const errorMessages = [
      profilesResult.error
        ? `profiles: ${profilesResult.error.message}. Run supabase/fix_rls.sql in Supabase SQL Editor.`
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
          ? "No active workplaces found. Run supabase/schema.sql or supabase/fix_rls.sql in Supabase SQL Editor."
          : null,
    );
    setLoading(false);
  }, [firstGridDate, lastGridDate, user]);

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

  async function handleLogout() {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  async function handleSave(payload: { workplaceId: string; note: string }) {
    if (!user || !selectedDay) {
      return;
    }

    setSaving(true);
    setModalError(null);

    const supabase = getSupabaseClient();
    const ownStatus = statuses.find(
      (status) =>
        status.user_id === user.id && status.work_date === selectedDay.isoDate,
    );

    const savePayload = {
      workplace_id: payload.workplaceId,
      note: payload.note.trim() || null,
    };

    const result = ownStatus
      ? await supabase
          .from("daily_status")
          .update(savePayload)
          .eq("id", ownStatus.id)
      : await supabase.from("daily_status").insert({
          user_id: user.id,
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
  }

  async function handleDelete() {
    if (!user || !selectedDay) {
      return;
    }

    const ownStatus = statuses.find(
      (status) =>
        status.user_id === user.id && status.work_date === selectedDay.isoDate,
    );

    if (!ownStatus) {
      return;
    }

    setSaving(true);
    setModalError(null);

    const supabase = getSupabaseClient();
    const { error: deleteError } = await supabase
      .from("daily_status")
      .delete()
      .eq("id", ownStatus.id);

    if (deleteError) {
      setModalError(deleteError.message);
      setSaving(false);
      return;
    }

    await loadMonthData();
    setSaving(false);
    setSelectedDay(null);
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
                statuses={statusesByDate[day.isoDate] || []}
                onSelect={setSelectedDay}
              />
            ))}
          </div>
        </section>
      </main>

      {selectedDay && user ? (
        <StatusModal
          selectedDate={selectedDay.isoDate}
          currentUserId={user.id}
          statuses={statusesByDate[selectedDay.isoDate] || []}
          workplaces={workplaces}
          saving={saving}
          error={modalError}
          onClose={() => {
            setSelectedDay(null);
            setModalError(null);
          }}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      ) : null}
    </div>
  );
}
