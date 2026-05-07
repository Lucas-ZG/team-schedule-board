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
    workplaceId: string;
    note: string;
  }) => Promise<void>;
};

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
  const [workplaceId, setWorkplaceId] = useState("");
  const [note, setNote] = useState("");

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
    setWorkplaceId(workplaces[0]?.id || "");
  }, [workplaces]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUserId || !workplaceId || selectedDateCount === 0) {
      return;
    }

    await onApply({ userId: selectedUserId, workplaceId, note });
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

          <label className={isAdmin ? "mt-4 block" : "block"}>
            <span className="text-sm font-medium text-slate-700">
              Workplace
            </span>
            <select
              className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-slate-950 shadow-sm disabled:bg-slate-100 disabled:text-slate-500"
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
                !workplaceId ||
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
