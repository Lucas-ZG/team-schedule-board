"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { CalendarStatus, Profile, Workplace } from "@/types/database";

type StatusModalProps = {
  selectedDate: string;
  currentUserId: string;
  isAdmin: boolean;
  selectedStatusUserId: string | null;
  profiles: Profile[];
  statuses: CalendarStatus[];
  workplaces: Workplace[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (payload: {
    userId: string;
    workplaceIds: string[];
    note: string;
    overtimeEnabled: boolean;
    overtimeHours: number;
  }) => Promise<void>;
  onDelete: (userId: string) => Promise<void>;
};

const OVERTIME_HOUR_OPTIONS = Array.from({ length: 48 }, (_, index) => (index + 1) * 0.5);
const DEFAULT_OVERTIME_HOURS = 1;

function memberLabel(profile?: Profile) {
  return profile?.display_name || profile?.email || "Unknown member";
}

function statusMemberLabel(status: CalendarStatus) {
  return memberLabel(status.profile);
}

function resolveStatusWorkplaces(
  status: CalendarStatus,
  workplaces: Workplace[],
): Workplace[] {
  const workplaceById = new Map(workplaces.map((entry) => [entry.id, entry]));
  const ids =
    status.workplace_ids && status.workplace_ids.length > 0
      ? status.workplace_ids
      : status.workplace_id
        ? [status.workplace_id]
        : [];
  return ids
    .map((id) => workplaceById.get(id) || status.workplace)
    .filter((entry): entry is Workplace => Boolean(entry));
}

function statusWorkplaceText(status: CalendarStatus, workplaces: Workplace[]) {
  const resolved = resolveStatusWorkplaces(status, workplaces);
  if (resolved.length === 0) {
    return "Unknown";
  }
  return resolved
    .map((entry) => (entry.is_dayoff ? "Dayoff" : entry.name))
    .join("/");
}

function statusIsDayoff(status: CalendarStatus, workplaces: Workplace[]) {
  return resolveStatusWorkplaces(status, workplaces).some(
    (entry) => entry.is_dayoff,
  );
}

export default function StatusModal({
  selectedDate,
  currentUserId,
  isAdmin,
  selectedStatusUserId,
  profiles,
  statuses,
  workplaces,
  saving,
  error,
  onClose,
  onSave,
  onDelete,
}: StatusModalProps) {
  const sortedProfiles = useMemo(
    () =>
      [...profiles].sort((left, right) =>
        memberLabel(left).localeCompare(memberLabel(right)),
      ),
    [profiles],
  );

  const [selectedUserId, setSelectedUserId] = useState(currentUserId);
  const isViewingOtherUser =
    !isAdmin &&
    selectedStatusUserId !== null &&
    selectedStatusUserId !== currentUserId;
  const targetUserId = isAdmin
    ? selectedUserId
    : isViewingOtherUser
      ? selectedStatusUserId
      : currentUserId;
  const targetStatus = useMemo(
    () => statuses.find((status) => status.user_id === targetUserId) || null,
    [statuses, targetUserId],
  );
  const canEdit = isAdmin || targetUserId === currentUserId;
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

    const requestedUserId = selectedStatusUserId || currentUserId;
    const requestedUserExists = profiles.some(
      (profile) => profile.id === requestedUserId,
    );

    setSelectedUserId(
      requestedUserExists ? requestedUserId : profiles[0]?.id || currentUserId,
    );
  }, [currentUserId, isAdmin, profiles, selectedStatusUserId]);

  useEffect(() => {
    const availableIds = new Set(workplaces.map((entry) => entry.id));
    const existingIds =
      targetStatus?.workplace_ids && targetStatus.workplace_ids.length > 0
        ? targetStatus.workplace_ids
        : targetStatus?.workplace_id
          ? [targetStatus.workplace_id]
          : [];
    const filtered = existingIds.filter((id) => availableIds.has(id));
    setWorkplaceIds(filtered);
    setNote(targetStatus?.note || "");
    setOvertimeEnabled(Boolean(targetStatus?.overtime_enabled));
    setOvertimeHours(
      targetStatus?.overtime_enabled && Number(targetStatus?.overtime_hours) > 0
        ? Number(targetStatus.overtime_hours)
        : DEFAULT_OVERTIME_HOURS,
    );
  }, [targetStatus, workplaces]);

  function toggleWorkplace(id: string) {
    if (!canEdit) {
      return;
    }
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
      // Selecting a non-dayoff option clears any previously selected dayoff.
      const filtered = current.filter((entry) => {
        const workplace = workplaceById.get(entry);
        return workplace ? !workplace.is_dayoff : true;
      });
      return [...filtered, id];
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || !targetUserId || workplaceIds.length === 0) {
      return;
    }

    await onSave({
      userId: targetUserId,
      workplaceIds,
      note,
      overtimeEnabled,
      overtimeHours: overtimeEnabled ? overtimeHours : 0,
    });
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
                  <button
                    type="button"
                    key={status.id}
                    onClick={() => {
                      if (isAdmin) {
                        setSelectedUserId(status.user_id);
                      }
                    }}
                    className={[
                      "w-full rounded-md border px-3 py-2 text-left",
                      status.user_id === targetUserId
                        ? "border-blue-300 bg-blue-50"
                        : "border-slate-200 bg-slate-50",
                      isAdmin ? "hover:border-blue-300" : "",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-slate-800">
                        {statusMemberLabel(status)}
                      </span>
                      <span
                        className={[
                          "rounded border px-2 py-0.5 text-xs font-semibold",
                          statusIsDayoff(status, workplaces)
                            ? "border-red-200 bg-red-100 text-red-700"
                            : "border-slate-200 bg-white text-slate-700",
                        ].join(" ")}
                      >
                        {statusWorkplaceText(status, workplaces)}
                      </span>
                    </div>
                    {status.note ? (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-500">
                        {status.note}
                      </p>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <h3 className="text-sm font-semibold text-slate-900">
              {isAdmin ? "Edit member status" : "Your status"}
            </h3>

            {isAdmin ? (
              <label className="mt-3 block">
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

            {!canEdit ? (
              <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                View only. You can edit only your own status.
              </p>
            ) : null}

            <fieldset className="mt-3" disabled={!canEdit || workplaces.length === 0}>
              <legend className="text-sm font-medium text-slate-700">
                Workplace
              </legend>
              <p className="mt-1 text-xs text-slate-500">
                Select one or more. Dayoff is exclusive.
              </p>
              {workplaces.length === 0 ? (
                <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  No active workplaces found. Run supabase/schema.sql or
                  supabase/add_admin_role.sql, then refresh this page.
                </p>
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {workplaces.map((workplace) => {
                    const checked = workplaceIds.includes(workplace.id);
                    return (
                      <label
                        key={workplace.id}
                        className={[
                          "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
                          checked
                            ? workplace.is_dayoff
                              ? "border-red-300 bg-red-50 text-red-800"
                              : "border-blue-300 bg-blue-50 text-blue-900"
                            : "border-slate-200 bg-white text-slate-700",
                          canEdit ? "cursor-pointer" : "cursor-not-allowed",
                        ].join(" ")}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          checked={checked}
                          onChange={() => toggleWorkplace(workplace.id)}
                          disabled={!canEdit}
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
                className="mt-2 min-h-28 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2.5 text-slate-950 shadow-sm disabled:bg-slate-100 disabled:text-slate-500"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Optional"
                disabled={!canEdit}
              />
            </label>

            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                  checked={overtimeEnabled}
                  onChange={(event) => setOvertimeEnabled(event.target.checked)}
                  disabled={!canEdit}
                />
                <span className="text-sm font-medium text-slate-700">Overtime</span>
              </label>

              {overtimeEnabled ? (
                <label className="mt-3 block">
                  <span className="text-xs font-medium text-slate-600">
                    Overtime Hours
                  </span>
                  <select
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-950 shadow-sm disabled:bg-slate-100 disabled:text-slate-500"
                    value={overtimeHours}
                    onChange={(event) =>
                      setOvertimeHours(Number(event.target.value))
                    }
                    disabled={!canEdit}
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
                onClick={() => onDelete(targetUserId)}
                disabled={!canEdit || !targetStatus || saving}
                className="rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
              >
                Delete
              </button>
              <button
                type="submit"
                disabled={
                  !canEdit ||
                  saving ||
                  workplaceIds.length === 0 ||
                  workplaces.length === 0
                }
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
