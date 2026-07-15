"use client";

import { FormEvent, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { getKoreanDateParts, todaySeoulIsoDate } from "@/lib/timezone";
import type { OtPeriod } from "@/types/database";

type OTPeriodSettingsProps = {
  initialPeriod: OtPeriod | null;
  onClose: () => void;
  onSaved: () => void;
};

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

// Pure calendar arithmetic on explicit y/m/d integers (no "now" involved),
// done in UTC so it can't be perturbed by DST or the machine's local zone.
function isoFromYMD(year: number, month0: number, day: number) {
  const d = new Date(Date.UTC(year, month0, day));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function computeAutoPeriod(today: Date, startDay: number) {
  // `today` is resolved to its Asia/Seoul calendar date, not the machine's
  // local date, so the computed period matches KST regardless of where this
  // runs.
  const { year, monthNumber, dayNumber } = getKoreanDateParts(today);
  const month = monthNumber - 1;
  const day = dayNumber;

  let startYear: number;
  let startMonth: number;
  if (day >= startDay) {
    startYear = year;
    startMonth = month;
  } else if (month === 0) {
    startYear = year - 1;
    startMonth = 11;
  } else {
    startYear = year;
    startMonth = month - 1;
  }

  const endMonth = startMonth === 11 ? 0 : startMonth + 1;
  const endYear = startMonth === 11 ? startYear + 1 : startYear;

  return {
    start: isoFromYMD(startYear, startMonth, startDay),
    end: isoFromYMD(endYear, endMonth, startDay - 1),
  };
}

function todayIso() {
  return todaySeoulIsoDate();
}

export default function OTPeriodSettings({
  initialPeriod,
  onClose,
  onSaved,
}: OTPeriodSettingsProps) {
  const [autoCalculate, setAutoCalculate] = useState<boolean>(
    Boolean(initialPeriod?.auto_calculate),
  );
  const [autoStartDay, setAutoStartDay] = useState<number>(
    initialPeriod?.auto_start_day ?? 1,
  );
  const [startDate, setStartDate] = useState<string>(
    initialPeriod?.start_date ?? todayIso(),
  );
  const [endDate, setEndDate] = useState<string>(
    initialPeriod?.end_date ?? todayIso(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (autoCalculate) {
      const { start, end } = computeAutoPeriod(new Date(), autoStartDay);
      setStartDate(start);
      setEndDate(end);
    }
  }, [autoCalculate, autoStartDay]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!startDate || !endDate) {
      setError("Start date and end date are required.");
      return;
    }
    if (endDate < startDate) {
      setError("End date must be on or after start date.");
      return;
    }
    if (autoCalculate && (autoStartDay < 1 || autoStartDay > 28)) {
      setError("Auto start day must be between 1 and 28.");
      return;
    }

    setSaving(true);
    const supabase = getSupabaseClient();
    const payload = {
      start_date: startDate,
      end_date: endDate,
      auto_calculate: autoCalculate,
      auto_start_day: autoCalculate ? autoStartDay : null,
    };

    const result = initialPeriod
      ? await supabase
          .from("ot_periods")
          .update(payload)
          .eq("id", initialPeriod.id)
      : await supabase.from("ot_periods").insert(payload);

    if (result.error) {
      setError(result.error.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 px-4 py-6 sm:items-center">
      <section className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-lg bg-white shadow-soft">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-700">
              Admin
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">
              OT Period Settings
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Set the date range used by the Monthly OT Summary.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>

        <form className="px-5 py-5" onSubmit={handleSubmit}>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
              checked={autoCalculate}
              onChange={(event) => setAutoCalculate(event.target.checked)}
            />
            <span className="text-sm font-medium text-slate-700">
              Auto-calculate from a monthly start day
            </span>
          </label>

          {autoCalculate ? (
            <div className="mt-4">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  Monthly start day
                </span>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={autoStartDay}
                  onChange={(event) =>
                    setAutoStartDay(
                      Math.min(28, Math.max(1, Number(event.target.value) || 1)),
                    )
                  }
                  className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-slate-950 shadow-sm"
                />
                <span className="mt-1 block text-xs text-slate-500">
                  Period runs from this day each month to the day before it next month (1-28).
                </span>
              </label>

              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Computed period: {startDate} ~ {endDate}
              </div>
            </div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  Start date
                </span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-slate-950 shadow-sm"
                  required
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  End date
                </span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-slate-950 shadow-sm"
                  required
                />
              </label>
            </div>
          )}

          {error ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
