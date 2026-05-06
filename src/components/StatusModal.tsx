"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { CalendarStatus, Workplace } from "@/types/database";

type StatusModalProps = {
  selectedDate: string;
  currentUserId: string;
  statuses: CalendarStatus[];
  workplaces: Workplace[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (payload: { workplaceId: string; note: string }) => Promise<void>;
  onDelete: () => Promise<void>;
};

function displayName(status: CalendarStatus) {
  return status.profile?.display_name || "Unknown";
}

function workplaceLabel(status: CalendarStatus) {
  return status.workplace?.name || "Unknown";
}

export default function StatusModal({
  selectedDate,
  currentUserId,
  statuses,
  workplaces,
  saving,
  error,
  onClose,
  onSave,
  onDelete,
}: StatusModalProps) {
  const ownStatus = useMemo(
    () => statuses.find((status) => status.user_id === currentUserId) || null,
    [currentUserId, statuses],
  );
  const [workplaceId, setWorkplaceId] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    const ownWorkplaceIsAvailable = workplaces.some(
      (workplace) => workplace.id === ownStatus?.workplace_id,
    );

    setWorkplaceId(
      ownWorkplaceIsAvailable ? ownStatus!.workplace_id : workplaces[0]?.id || "",
    );
    setNote(ownStatus?.note || "");
  }, [ownStatus, workplaces]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workplaceId) {
      return;
    }

    await onSave({ workplaceId, note });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 px-4 py-6 sm:items-center">
      <section className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-soft">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-blue-600">
              Selected Date
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">
              {selectedDate}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>

        <div className="grid gap-6 px-5 py-5 md:grid-cols-[1fr_1.15fr]">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              All member statuses
            </h3>
            <div className="mt-3 space-y-2">
              {statuses.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500">
                  No status for this date.
                </p>
              ) : (
                statuses.map((status) => (
                  <div
                    key={status.id}
                    className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-slate-800">
                        {displayName(status)}
                      </span>
                      <span
                        className={[
                          "rounded border px-2 py-0.5 text-xs font-semibold",
                          status.workplace?.is_dayoff
                            ? "border-red-200 bg-red-100 text-red-700"
                            : "border-slate-200 bg-white text-slate-700",
                        ].join(" ")}
                      >
                        {workplaceLabel(status)}
                      </span>
                    </div>
                    {status.note ? (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-500">
                        {status.note}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <h3 className="text-sm font-semibold text-slate-900">
              Your status
            </h3>

            <label className="mt-3 block">
              <span className="text-sm font-medium text-slate-700">
                Workplace
              </span>
              <select
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-slate-950 shadow-sm"
                value={workplaceId}
                onChange={(event) => setWorkplaceId(event.target.value)}
                disabled={workplaces.length === 0}
                required
              >
                {workplaces.length === 0 ? (
                  <option value="">No active workplaces</option>
                ) : null}
                {workplaces.map((workplace) => (
                  <option key={workplace.id} value={workplace.id}>
                    {workplace.name}
                  </option>
                ))}
              </select>
            </label>

            {workplaces.length === 0 ? (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                No active workplaces found. Run supabase/schema.sql or
                supabase/fix_rls.sql, then refresh this page.
              </p>
            ) : null}

            <label className="mt-4 block">
              <span className="text-sm font-medium text-slate-700">Note</span>
              <textarea
                className="mt-2 min-h-28 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2.5 text-slate-950 shadow-sm"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Optional"
              />
            </label>

            {error ? (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onDelete}
                disabled={!ownStatus || saving}
                className="rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
              >
                Delete
              </button>
              <button
                type="submit"
                disabled={saving || !workplaceId || workplaces.length === 0}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
