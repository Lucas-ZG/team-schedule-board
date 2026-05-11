"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Profile, Workplace } from "@/types/database";

type BatchStatusModalProps = {
  selectedDateCount: number;
  currentUserId: string;
  isAdmin: boolean;
  profiles: Profile[];
  workplaces: Workplace[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onApply: (payload: {
    userId: string;
    workplaceIds: string[];
    note: string;
    overtimeEnabled: boolean;
    overtimeHours: number;
  }) => Promise<void>;
};

const OVERTIME_HOUR_OPTIONS = Array.from({ length: 48 }, (_, index) => (index + 1) * 0.5);
const DEFAULT_OVERTIME_HOURS = 1;

function memberLabel(profile?: Profile) {
  return profile?.display_name || profile?.email || "Unknown member";
}

export default function BatchStatusModal({
  selectedDateCount,
  currentUserId,
  isAdmin,
  profiles,
  workplaces,
  saving,
  error,
  onClose,
  onApply,
}: BatchStatusModalProps) {
  const sortedProfiles = useMemo(
    () =>
      [...profiles].sort((left, right) =>
        memberLabel(left).localeCompare(memberLabel(right)),
      ),
    [profiles],
  );
  const [selectedUserId, setSelectedUserId] = useState(currentUserId);
  const [workplaceIds, setWorkplaceIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [overtimeEnabled, setOvertimeEnabled] = useState(false);
  const [overtimeHours, setOvertimeHours] = useState<number>(DEFAULT_OVERTIME_HOURS);

  const workplaceById = useMemo(
    () => new Map(workplaces.map((entry) => [entry.id, entry])),
    [workplaces],
  );

  useEffect(() => {
    if (!isAdmin) {
      setSelectedUserId(currentUserId);
      return;
    }

    const currentUserExists = profiles.some(
      (profile) => profile.id === currentUserId,
    );
    setSelectedUserId(currentUserExists ? currentUserId : profiles[0]?.id || "");
  }, [currentUserId, isAdmin, profiles]);

  useEffect(() => {
    setWorkplaceIds((current) =>
      current.filter((id) => workplaces.some((entry) => entry.id === id)),
    );
  }, [workplaces]);

  function toggleWorkplace(id: string) {
    const target = workplaceById.get(id);
    const isDayoff = Boolean(target?.is_dayoff);
    setWorkplaceIds((current) => {
      const has = current.includes(id);
      if (has) {
        return current.filter((entry) => entry !== id);
      }
      if (isDayoff) {
        return [id];
      }
      const filtered = current.filter((entry) => {
        const workplace = workplaceById.get(entry);
        return workplace ? !workplace.is_dayoff : true;
      });
      return [...filtered, id];
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUserId || workplaceIds.length === 0 || selectedDateCount === 0) {
      return;
    }

    await onApply({
      userId: selectedUserId,
      workplaceIds,
      note,
      overtimeEnabled,
      overtimeHours: overtimeEnabled ? overtimeHours : 0,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 px-4 py-6 sm:items-center">
      <section className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white shadow-soft">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-blue-600">
              Batch Update
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">
              Apply status to selected dates
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Selected dates: {selectedDateCount}
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
          {isAdmin ? (
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Member
              </span>
              <select
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-slate-950 shadow-sm"
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
                required
              >
                {sortedProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {memberLabel(profile)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <fieldset className={isAdmin ? "mt-4" : ""} disabled={workplaces.length === 0}>
            <legend className="text-sm font-medium text-slate-700">
              Workplace
            </legend>
            <p className="mt-1 text-xs text-slate-500">
              Select one or more. Dayoff is exclusive.
            </p>
            {workplaces.length === 0 ? (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                No active workplaces found.
              </p>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {workplaces.map((workplace) => {
                  const checked = workplaceIds.includes(workplace.id);
                  return (
                    <label
                      key={workplace.id}
                      className={[
                        "flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer",
                        checked
                          ? workplace.is_dayoff
                            ? "border-red-300 bg-red-50 text-red-800"
                            : "border-blue-300 bg-blue-50 text-blue-900"
                          : "border-slate-200 bg-white text-slate-700",
                      ].join(" ")}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        checked={checked}
                        onChange={() => toggleWorkplace(workplace.id)}
                      />
                      <span className="truncate font-medium">
                        {workplace.is_dayoff ? "Dayoff" : workplace.name}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>

          <label className="mt-4 block">
            <span className="text-sm font-medium text-slate-700">Note</span>
            <textarea
              className="mt-2 min-h-28 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2.5 text-slate-950 shadow-sm"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional"
            />
          </label>

          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                checked={overtimeEnabled}
                onChange={(event) => setOvertimeEnabled(event.target.checked)}
              />
              <span className="text-sm font-medium text-slate-700">Overtime</span>
            </label>

            {overtimeEnabled ? (
              <label className="mt-3 block">
                <span className="text-xs font-medium text-slate-600">
                  Overtime Hours
                </span>
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-950 shadow-sm"
                  value={overtimeHours}
                  onChange={(event) =>
                    setOvertimeHours(Number(event.target.value))
                  }
                >
                  {OVERTIME_HOUR_OPTIONS.map((hours) => (
                    <option key={hours} value={hours}>
                      {hours.toFixed(1)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
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
              disabled={saving}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                saving ||
                !selectedUserId ||
                workplaceIds.length === 0 ||
                workplaces.length === 0 ||
                selectedDateCount === 0
              }
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {saving ? "Applying..." : "Apply"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
