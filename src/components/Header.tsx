"use client";

type HeaderProps = {
  userLabel: string;
  onLogout: () => void;
};

export default function Header({ userLabel, onLogout }: HeaderProps) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-blue-600">
            Team Schedule
          </p>
          <h1 className="text-xl font-semibold text-slate-950">
            Workplace & Day Off Calendar
          </h1>
        </div>

        <div className="flex min-w-0 items-center gap-3">
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
