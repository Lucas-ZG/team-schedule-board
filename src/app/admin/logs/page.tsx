"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import {
  getSupabaseClient,
  getSupabaseConfigError,
} from "@/lib/supabaseClient";
import type { ActivityLog, Profile } from "@/types/database";

const PAGE_SIZE = 50;

const EVENT_LABEL: Record<ActivityLog["event_type"], string> = {
  login: "Login",
  create: "Create",
  update: "Update",
  delete: "Delete",
};

export default function AdminLogsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  // null = still checking, false = confirmed not admin, true = confirmed admin
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  }, [router]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const supabase = getSupabaseClient();
    supabase
      .from("profiles")
      .select("*")
      .then(({ data, error: profilesError }) => {
        if (profilesError) {
          setError(profilesError.message);
          setIsAdmin(false);
          return;
        }
        const nextProfiles = data || [];
        setProfiles(nextProfiles);
        const me = nextProfiles.find((profile) => profile.id === user.id);
        if (!me || me.role !== "admin") {
          setIsAdmin(false);
          router.replace("/");
          return;
        }
        setIsAdmin(true);
      });
  }, [user, router]);

  const loadLogs = useCallback(async () => {
    if (!isAdmin) {
      return;
    }

    setLoading(true);
    const supabase = getSupabaseClient();
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error: logsError, count } = await supabase
      .from("activity_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (logsError) {
      setError(logsError.message);
      setLoading(false);
      return;
    }

    setLogs((data || []) as ActivityLog[]);
    setTotalCount(count ?? 0);
    setError(null);
    setLoading(false);
  }, [isAdmin, page]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  function profileLabel(userId: string | null) {
    if (!userId) {
      return "Unknown";
    }
    const profile = profiles.find((entry) => entry.id === userId);
    return profile?.display_name || profile?.email || userId;
  }

  if (isAdmin === null && error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f8fb] px-4">
        <div className="max-w-lg rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          {error}
        </div>
      </main>
    );
  }

  if (isAdmin === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f8fb] px-4">
        <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600 shadow-soft">
          Loading...
        </div>
      </main>
    );
  }

  if (isAdmin === false) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f8fb] px-4">
        <div className="max-w-lg rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          You do not have permission to view this page.
        </div>
      </main>
    );
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-[#f7f8fb]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-blue-600">
              Team Schedule
            </p>
            <h1 className="text-xl font-semibold text-slate-950">
              Activity Logs (Admin only)
            </h1>
          </div>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Back to calendar
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <p className="mb-4 text-sm text-slate-500">
          Login and daily-status (shift/OT/leave) create/update/delete events,
          newest first. This is a usage log, not a tamper-proof security audit
          trail: it is written by the client after a successful login or edit,
          so a call made directly against the Supabase API (bypassing this
          app) would not appear here.
        </p>

        {error ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-soft">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">
                  User
                </th>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">
                  Event
                </th>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">
                  Time
                </th>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">
                  Target
                </th>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">
                  Detail
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    Loading...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    No activity recorded yet.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id}>
                    <td className="px-4 py-2 text-slate-800">
                      {profileLabel(log.user_id)}
                    </td>
                    <td className="px-4 py-2 text-slate-800">
                      {EVENT_LABEL[log.event_type] || log.event_type}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-600">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {log.target_table ? (
                        <>
                          <span>{log.target_table}</span>
                          {log.target_id ? (
                            <span className="block truncate font-mono text-xs text-slate-400">
                              {log.target_id}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="max-w-md px-4 py-2 text-slate-600">
                      <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                        {log.detail ? JSON.stringify(log.detail) : "-"}
                      </pre>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
          <span>
            Page {page + 1} of {totalPages} ({totalCount} total)
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              disabled={page === 0}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() =>
                setPage((value) => Math.min(totalPages - 1, value + 1))
              }
              disabled={page + 1 >= totalPages}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
