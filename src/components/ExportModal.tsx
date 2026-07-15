"use client";

import { FormEvent, useMemo, useState } from "react";
import * as XLSX from "xlsx-js-style";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { firstOfSeoulMonth, lastOfSeoulMonth } from "@/lib/timezone";
import type { DailyStatus, Profile, Workplace } from "@/types/database";

type ExportModalProps = {
  onClose: () => void;
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fileTag(isoDate: string) {
  return isoDate.replace(/-/g, "");
}

function memberLabel(profile?: Profile | null) {
  return profile?.display_name || profile?.email || "Unknown";
}

function formatDateLabel(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  return `${WEEKDAY_LABELS[date.getDay()]} ${date.getMonth() + 1}/${date.getDate()}`;
}

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

// Formats a local-midnight Date (parsed from an ISO date string) back into
// that same ISO string. This only round-trips a wall-clock date the caller
// already produced; it has no dependency on "now" or the machine's
// timezone, so it does not need to go through the Seoul-only helpers.
function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function enumerateDates(startIso: string, endIso: string): string[] {
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return [];
  }
  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(toIsoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function workplaceTextFor(
  rows: DailyStatus[],
  workplaces: Map<string, Workplace>,
): string {
  if (rows.length === 0) {
    return "";
  }
  const parts: string[] = [];
  rows.forEach((row) => {
    const ids =
      row.workplace_ids && row.workplace_ids.length > 0
        ? row.workplace_ids
        : row.workplace_id
          ? [row.workplace_id]
          : [];
    ids.forEach((id) => {
      const workplace = workplaces.get(id);
      if (!workplace) {
        return;
      }
      parts.push(workplace.is_dayoff ? "Dayoff" : workplace.name);
    });
  });
  // De-dupe but keep insertion order.
  const seen = new Set<string>();
  const unique: string[] = [];
  parts.forEach((value) => {
    if (!seen.has(value)) {
      seen.add(value);
      unique.push(value);
    }
  });
  return unique.join("/");
}

export default function ExportModal({ onClose }: ExportModalProps) {
  const defaults = useMemo(() => {
    const now = new Date();
    return {
      start: firstOfSeoulMonth(now),
      end: lastOfSeoulMonth(now),
    };
  }, []);

  const [startDate, setStartDate] = useState<string>(defaults.start);
  const [endDate, setEndDate] = useState<string>(defaults.end);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!startDate || !endDate) {
      setError("Please pick a start date and an end date.");
      return;
    }
    if (endDate < startDate) {
      setError("End date must be on or after start date.");
      return;
    }

    setBusy(true);
    try {
      const supabase = getSupabaseClient();

      const [profilesResult, workplacesResult, statusesResult] = await Promise.all([
        supabase.from("profiles").select("*").order("display_name"),
        supabase.from("workplaces").select("*"),
        supabase
          .from("daily_status")
          .select("*")
          .gte("work_date", startDate)
          .lte("work_date", endDate)
          .order("work_date", { ascending: true })
          .order("created_at", { ascending: true }),
      ]);

      if (profilesResult.error) throw profilesResult.error;
      if (workplacesResult.error) throw workplacesResult.error;
      if (statusesResult.error) throw statusesResult.error;

      const profiles = (profilesResult.data as Profile[]) || [];
      const workplaceList = (workplacesResult.data as Workplace[]) || [];
      const statuses = (statusesResult.data as DailyStatus[]) || [];

      const workplaceMap = new Map(workplaceList.map((w) => [w.id, w]));
      const dates = enumerateDates(startDate, endDate);

      // Sort members by sort_order ASC (matching the calendar). Ties broken by
      // display name so the output remains deterministic.
      const sortedProfiles = [...profiles].sort((left, right) => {
        const delta =
          (left.sort_order ?? Number.MAX_SAFE_INTEGER) -
          (right.sort_order ?? Number.MAX_SAFE_INTEGER);
        if (delta !== 0) {
          return delta;
        }
        return memberLabel(left).localeCompare(memberLabel(right), undefined, {
          sensitivity: "base",
        });
      });

      // Group statuses by user -> date -> rows[]
      const byUserDate = new Map<string, Map<string, DailyStatus[]>>();
      statuses.forEach((row) => {
        let userMap = byUserDate.get(row.user_id);
        if (!userMap) {
          userMap = new Map<string, DailyStatus[]>();
          byUserDate.set(row.user_id, userMap);
        }
        const existing = userMap.get(row.work_date);
        if (existing) {
          existing.push(row);
        } else {
          userMap.set(row.work_date, [row]);
        }
      });

      // Build a 2D array-of-arrays for the worksheet.
      // Row 0: per member, the display name in the date column; workplace column blank (merged).
      // Row 1..N: date label + workplace text.
      const headerRow: string[] = [];
      sortedProfiles.forEach((profile) => {
        headerRow.push(memberLabel(profile));
        headerRow.push("");
      });

      const dataRows: string[][] = dates.map((iso) => {
        const row: string[] = [];
        sortedProfiles.forEach((profile) => {
          const userMap = byUserDate.get(profile.id);
          const dayRows = userMap?.get(iso) || [];
          row.push(formatDateLabel(iso));
          row.push(workplaceTextFor(dayRows, workplaceMap));
        });
        return row;
      });

      const aoa: string[][] = [headerRow, ...dataRows];
      const worksheet = XLSX.utils.aoa_to_sheet(aoa);

      // Merge each pair of header cells (display_name spans two columns), plus
      // for each member's workplace column, merge runs of identical non-empty
      // values across consecutive rows.
      const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];

      sortedProfiles.forEach((_, index) => {
        merges.push({
          s: { r: 0, c: index * 2 },
          e: { r: 0, c: index * 2 + 1 },
        });

        const workplaceCol = index * 2 + 1;
        let runStart = -1;
        let runValue = "";

        const flushRun = (endRow: number) => {
          if (runStart >= 0 && endRow > runStart && runValue !== "") {
            merges.push({
              s: { r: runStart, c: workplaceCol },
              e: { r: endRow, c: workplaceCol },
            });
          }
        };

        // Data rows are 1..dataRows.length.
        for (let row = 1; row <= dataRows.length; row += 1) {
          const value = dataRows[row - 1][workplaceCol] || "";
          if (value !== "" && value === runValue) {
            // continue the current run
            continue;
          }
          // run ended on previous row
          flushRun(row - 1);
          // start a new run only when the value is non-empty
          if (value !== "") {
            runStart = row;
            runValue = value;
          } else {
            runStart = -1;
            runValue = "";
          }
        }
        // Flush the final run, if any.
        flushRun(dataRows.length);
      });

      worksheet["!merges"] = merges;

      // Column widths: alternating 10 (date) / 15 (workplace).
      worksheet["!cols"] = sortedProfiles.flatMap(() => [
        { wch: 10 },
        { wch: 15 },
      ]);

      // Stamp every cell with center alignment + a thin black border. The
      // merged display-name cell (row 0) is also bolded. Note: SheetJS
      // community edition reads/writes cell.s only in some configurations;
      // for full styling support in production you may need xlsx-js-style.
      const thinBorder = { style: "thin", color: { rgb: "000000" } } as const;
      const baseAlignment = {
        horizontal: "center" as const,
        vertical: "center" as const,
        wrapText: true,
      };
      const baseBorder = {
        top: thinBorder,
        bottom: thinBorder,
        left: thinBorder,
        right: thinBorder,
      };

      const totalRows = aoa.length;
      const totalCols = sortedProfiles.length * 2;
      for (let r = 0; r < totalRows; r += 1) {
        for (let c = 0; c < totalCols; c += 1) {
          const address = XLSX.utils.encode_cell({ r, c });
          let cell = worksheet[address];
          if (!cell) {
            // Force-create empty cells so borders show up on blank workplace days.
            cell = { t: "s", v: "" };
            worksheet[address] = cell;
          }
          cell.s = {
            alignment: baseAlignment,
            border: baseBorder,
            ...(r === 0 ? { font: { bold: true } } : {}),
          };
        }
      }

      // Ensure the worksheet range covers every cell we just stamped.
      worksheet["!ref"] = XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: Math.max(totalRows - 1, 0), c: Math.max(totalCols - 1, 0) },
      });

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Schedule");

      const filename = `schedule_${fileTag(startDate)}_${fileTag(endDate)}.xlsx`;
      XLSX.writeFile(workbook, filename);

      setBusy(false);
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to export schedule.";
      setError(message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 px-4 py-6 sm:items-center">
      <section className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-lg bg-white shadow-soft">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-blue-600">
              Admin
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">
              Export Schedule
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Download an Excel file of every member&apos;s workplaces in the chosen date range.
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

        <form className="px-5 py-5" onSubmit={handleSubmit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Start date
              </span>
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                disabled={busy}
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-slate-950 shadow-sm disabled:bg-slate-100"
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
                disabled={busy}
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-slate-950 shadow-sm disabled:bg-slate-100"
                required
              />
            </label>
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
              type="submit"
              disabled={busy}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {busy ? "Exporting..." : "Export Excel"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
