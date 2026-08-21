"use client";

import { useState, useEffect } from "react";
import * as XLSX from "xlsx-js-style";
import { getSupabaseClient } from "@/lib/supabaseClient";
import type { DailyStatus, Profile } from "@/types/database";

type Range = { start: string; end: string };

type OTExportModalProps = {
  otSummaryRange: Range;
  prevPeriodRange: Range;
  profiles: Profile[];
  isAdmin: boolean;
  onClose: () => void;
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fileTag(isoDate: string) {
  return isoDate.replace(/-/g, "");
}

function formatDateLabel(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  return `${WEEKDAY_LABELS[date.getDay()]} ${date.getMonth() + 1}/${date.getDate()}`;
}

function formatRangeDisplay(start: string, end: string) {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    return `${start} ~ ${end}`;
  }
  return `${s.getMonth() + 1}/${s.getDate()} ~ ${e.getMonth() + 1}/${e.getDate()}`;
}

function formatSheetName(start: string, end: string) {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    return `${start}_${end}`;
  }
  return `${s.getMonth() + 1}-${s.getDate()}~${e.getMonth() + 1}-${e.getDate()}`;
}

function sortedProfiles(profiles: Profile[]) {
  return [...profiles].sort((a, b) => {
    const oa =
      typeof a.sort_order === "number" ? a.sort_order : Number.MAX_SAFE_INTEGER;
    const ob =
      typeof b.sort_order === "number" ? b.sort_order : Number.MAX_SAFE_INTEGER;
    if (oa !== ob) {
      return oa - ob;
    }
    return (a.display_name || "").localeCompare(b.display_name || "");
  });
}

function computeUserTotal(
  statuses: DailyStatus[],
  range: Range,
  userId: string,
): number {
  let total = 0;
  statuses.forEach((s) => {
    if (s.user_id !== userId) return;
    if (!s.overtime_enabled) return;
    const hours = Number(s.overtime_hours) || 0;
    if (hours <= 0) return;
    if (s.work_date < range.start || s.work_date > range.end) return;
    total += hours;
  });
  return total;
}

function buildOTSheet(
  statuses: DailyStatus[],
  range: Range,
  members: Profile[],
): XLSX.WorkSheet {
  const thinBorder = { style: "thin", color: { rgb: "000000" } } as const;
  const baseBorder = {
    top: thinBorder,
    bottom: thinBorder,
    left: thinBorder,
    right: thinBorder,
  };
  const centerAlign = {
    horizontal: "center" as const,
    vertical: "center" as const,
    wrapText: true,
  };

  // Filter OT statuses in range, group by user_id -> work_date -> hours
  const byUser = new Map<string, Map<string, number>>();
  statuses.forEach((s) => {
    if (!s.overtime_enabled) return;
    const hours = Number(s.overtime_hours) || 0;
    if (hours <= 0) return;
    if (s.work_date < range.start || s.work_date > range.end) return;
    let byDate = byUser.get(s.user_id);
    if (!byDate) {
      byDate = new Map();
      byUser.set(s.user_id, byDate);
    }
    byDate.set(s.work_date, (byDate.get(s.work_date) || 0) + hours);
  });

  type MemberData = {
    profile: Profile;
    entries: { date: string; hours: number }[];
    total: number;
  };

  const allMemberData: MemberData[] = members.map((profile) => {
    const byDate = byUser.get(profile.id) || new Map<string, number>();
    const entries = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, hours]) => ({ date, hours }));
    const total = entries.reduce((sum, e) => sum + e.hours, 0);
    return { profile, entries, total };
  });

  // Only include members with total > 0
  const memberDataList = allMemberData.filter((m) => m.total > 0);

  if (memberDataList.length === 0) {
    const ws: XLSX.WorkSheet = {};
    ws["!ref"] = "A1:A1";
    ws["A1"] = { t: "s", v: "No overtime records found." };
    return ws;
  }

  const maxEntries = Math.max(...memberDataList.map((m) => m.entries.length), 0);
  const totalDataRows = maxEntries + 1; // +1 for Total row
  const ws: XLSX.WorkSheet = {};
  const merges: XLSX.Range[] = [];

  memberDataList.forEach((member, mi) => {
    const dateCol = mi * 2;
    const hoursCol = mi * 2 + 1;

    // Row 0: member name (merged across 2 cols), bold
    const nameAddr = XLSX.utils.encode_cell({ r: 0, c: dateCol });
    ws[nameAddr] = {
      t: "s",
      v: member.profile.display_name || member.profile.email || "Unknown",
      s: {
        alignment: centerAlign,
        border: baseBorder,
        font: { bold: true },
      },
    };
    const nameAddrRight = XLSX.utils.encode_cell({ r: 0, c: hoursCol });
    ws[nameAddrRight] = {
      t: "s",
      v: "",
      s: { alignment: centerAlign, border: baseBorder, font: { bold: true } },
    };
    merges.push({ s: { r: 0, c: dateCol }, e: { r: 0, c: hoursCol } });

    // Rows 1..maxEntries: OT entries (pad with blanks if fewer entries)
    for (let i = 0; i < maxEntries; i++) {
      const row = i + 1;
      const entry = member.entries[i];
      const dateAddr = XLSX.utils.encode_cell({ r: row, c: dateCol });
      const hoursAddr = XLSX.utils.encode_cell({ r: row, c: hoursCol });
      ws[dateAddr] = {
        t: "s",
        v: entry ? formatDateLabel(entry.date) : "",
        s: { alignment: centerAlign, border: baseBorder },
      };
      ws[hoursAddr] = {
        t: "s",
        v: entry ? `${entry.hours.toFixed(1)}h` : "",
        s: { alignment: centerAlign, border: baseBorder },
      };
    }

    // Total row (after all data rows)
    const totalRow = maxEntries + 1;
    const totalDateAddr = XLSX.utils.encode_cell({ r: totalRow, c: dateCol });
    const totalHoursAddr = XLSX.utils.encode_cell({ r: totalRow, c: hoursCol });
    ws[totalDateAddr] = {
      t: "s",
      v: `Total: ${member.total.toFixed(1)}h`,
      s: { alignment: centerAlign, border: baseBorder, font: { bold: true } },
    };
    ws[totalHoursAddr] = {
      t: "s",
      v: "",
      s: { alignment: centerAlign, border: baseBorder, font: { bold: true } },
    };
    merges.push({
      s: { r: totalRow, c: dateCol },
      e: { r: totalRow, c: hoursCol },
    });
  });

  const totalCols = memberDataList.length * 2;
  const totalRows = totalDataRows + 1; // +1 for header row
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: Math.max(totalRows - 1, 0), c: Math.max(totalCols - 1, 0) },
  });
  ws["!merges"] = merges;
  ws["!cols"] = memberDataList.flatMap(() => [{ wch: 12 }, { wch: 10 }]);

  return ws;
}

export default function OTExportModal({
  otSummaryRange,
  prevPeriodRange,
  profiles,
  isAdmin,
  onClose,
}: OTExportModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includePrev, setIncludePrev] = useState(true);
  const [includeCurr, setIncludeCurr] = useState(true);
  const [previewStatuses, setPreviewStatuses] = useState<DailyStatus[] | null>(
    null,
  );

  const members = sortedProfiles(profiles);
  const prevDisplay = formatRangeDisplay(prevPeriodRange.start, prevPeriodRange.end);
  const currDisplay = formatRangeDisplay(otSummaryRange.start, otSummaryRange.end);
  const prevSheetName = formatSheetName(prevPeriodRange.start, prevPeriodRange.end);
  const currSheetName = formatSheetName(otSummaryRange.start, otSummaryRange.end);

  // Eagerly fetch to preview which members have OT
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const supabase = getSupabaseClient();
    supabase
      .from("daily_status")
      .select("*")
      .gte("work_date", prevPeriodRange.start)
      .lte("work_date", otSummaryRange.end)
      .eq("overtime_enabled", true)
      .order("work_date", { ascending: true })
      .then(({ data, error: fetchError }) => {
        if (cancelled) return;
        if (!fetchError && data) {
          setPreviewStatuses(data as DailyStatus[]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [prevPeriodRange.start, otSummaryRange.end, isAdmin]);

  // Members with OT in at least one checked period (empty array while loading)
  const previewMembers = previewStatuses
    ? members.filter((m) => {
        const prevTotal = includePrev
          ? computeUserTotal(previewStatuses, prevPeriodRange, m.id)
          : 0;
        const currTotal = includeCurr
          ? computeUserTotal(previewStatuses, otSummaryRange, m.id)
          : 0;
        return prevTotal > 0 || currTotal > 0;
      })
    : [];

  const canExport = includePrev || includeCurr;

  function buildFilename() {
    if (includePrev && includeCurr) {
      return `OT_${fileTag(prevPeriodRange.start)}_${fileTag(otSummaryRange.end)}.xlsx`;
    }
    if (includePrev) {
      return `OT_${fileTag(prevPeriodRange.start)}_${fileTag(prevPeriodRange.end)}.xlsx`;
    }
    return `OT_${fileTag(otSummaryRange.start)}_${fileTag(otSummaryRange.end)}.xlsx`;
  }

  async function handleExport() {
    if (!isAdmin) {
      setError("Access denied. Admin privileges required to export OT data.");
      return;
    }
    if (!canExport) return;

    setError(null);
    setBusy(true);
    try {
      const supabase = getSupabaseClient();
      const { data, error: fetchError } = await supabase
        .from("daily_status")
        .select("*")
        .gte("work_date", prevPeriodRange.start)
        .lte("work_date", otSummaryRange.end)
        .eq("overtime_enabled", true)
        .order("work_date", { ascending: true });

      if (fetchError) throw fetchError;
      const statuses = (data as DailyStatus[]) || [];

      const wb = XLSX.utils.book_new();
      if (includePrev) {
        const prevSheet = buildOTSheet(statuses, prevPeriodRange, members);
        XLSX.utils.book_append_sheet(wb, prevSheet, prevSheetName);
      }
      if (includeCurr) {
        const currSheet = buildOTSheet(statuses, otSummaryRange, members);
        XLSX.utils.book_append_sheet(wb, currSheet, currSheetName);
      }

      XLSX.writeFile(wb, buildFilename());

      setBusy(false);
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to export OT data.";
      setError(message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 px-4 py-6 sm:items-center">
      <section className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-lg bg-white shadow-soft">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-600">
              Admin
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">
              Export OT Records
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Select periods to include in the Excel export.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            Cancel
          </button>
        </div>

        <div className="px-5 py-5">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <p className="font-medium text-slate-900">Periods to export</p>
            <ul className="mt-2 space-y-2">
              <li className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="period-prev"
                  checked={includePrev}
                  onChange={(e) => setIncludePrev(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                />
                <label htmlFor="period-prev" className="cursor-pointer">
                  <span className="font-medium">Previous period:</span>{" "}
                  <span className="font-semibold">{prevDisplay}</span>
                </label>
              </li>
              <li className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="period-curr"
                  checked={includeCurr}
                  onChange={(e) => setIncludeCurr(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                />
                <label htmlFor="period-curr" className="cursor-pointer">
                  <span className="font-medium">Current period:</span>{" "}
                  <span className="font-semibold">{currDisplay}</span>
                </label>
              </li>
            </ul>
            {!canExport && (
              <p className="mt-2 text-xs text-red-500">
                Please select at least one period.
              </p>
            )}
          </div>

          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <p className="font-medium text-slate-900">
              Members with overtime
              {previewStatuses !== null ? ` (${previewMembers.length})` : ""}
            </p>
            {previewStatuses === null ? (
              <p className="mt-1 text-slate-400">Loading...</p>
            ) : previewMembers.length === 0 ? (
              <p className="mt-1 text-slate-400">No overtime records found.</p>
            ) : (
              <p className="mt-1 text-slate-500">
                {previewMembers
                  .map((m) => m.display_name || m.email)
                  .join(" · ")}
              </p>
            )}
          </div>

          {error ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={busy || !canExport}
              className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300"
            >
              {busy ? "Exporting..." : "Export Excel"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
