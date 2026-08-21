"use client";

import Link from "next/link";

type HeaderProps = {
  userLabel: string;
  onLogout: () => void;
  isAdmin?: boolean;
};

export default function Header({ userLabel, onLogout, isAdmin }: HeaderProps) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-6 lg:px-8">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-blue-600">
            Team Schedule
          </p>
          <h1 className="text-xl font-semibold text-slate-950">
            Workplace & Day Off Calendar
          </h1>
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-3">
          {process.env.NEXT_PUBLIC_APP_VERSION ? (
            <span className="text-xs text-slate-400">
              v{process.env.NEXT_PUBLIC_APP_VERSION}
            </span>
          ) : null}
          {isAdmin ? (
            <Link
              href="/admin/create-user"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Create User
            </Link>
          ) : null}
          {isAdmin ? (
            <Link
              href="/admin/logs"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Logs
            </Link>
          ) : null}
          <span className="hidden max-w-[240px] truncate text-sm text-slate-600 sm:inline">
            {userLabel}
          </span>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}
