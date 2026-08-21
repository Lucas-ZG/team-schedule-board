"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import {
  getSupabaseClient,
  getSupabaseConfigError,
} from "@/lib/supabaseClient";
import type { Profile } from "@/types/database";

type Role = "admin" | "user" | "viewer";

const ROLE_OPTIONS: Role[] = ["user", "admin", "viewer"];

export default function AdminCreateUserPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  // null = still checking, false = confirmed not admin, true = confirmed admin
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const err = getSupabaseConfigError();
    if (err) {
      setConfigError(err);
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
      .eq("id", user.id)
      .single()
      .then(({ data, error: profileError }) => {
        const profile = data as Profile | null;
        if (profileError || !profile || profile.role !== "admin") {
          setIsAdmin(false);
          router.replace("/");
          return;
        }
        setIsAdmin(true);
      });
  }, [user, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setSubmitting(true);

    try {
      const supabase = getSupabaseClient();
      const { data, error: invokeError } = await supabase.functions.invoke(
        "create-user",
        {
          body: {
            email: email.trim(),
            password,
            role,
          },
        },
      );

      if (invokeError) {
        const context = (invokeError as { context?: Response }).context;
        let message = invokeError.message;
        if (context) {
          try {
            const body = await context.clone().json();
            if (body?.error) {
              message = body.error;
            }
          } catch {
            // ignore -- fall back to invokeError.message
          }
        }
        setError(message);
        return;
      }

      setSuccessMessage(
        `Account created: ${data?.email ?? email} (role: ${data?.role ?? role})`,
      );
      setEmail("");
      setPassword("");
      setRole("user");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  if (configError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f8fb] px-4">
        <div className="max-w-lg rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          {configError}
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

  return (
    <div className="min-h-screen bg-[#f7f8fb]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-blue-600">
              Team Schedule
            </p>
            <h1 className="text-xl font-semibold text-slate-950">
              Create User (Admin only)
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

      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-soft">
          <form className="space-y-5" onSubmit={handleSubmit}>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Email</span>
              <input
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-slate-950 shadow-sm transition focus:border-blue-500"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="off"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Password
              </span>
              <input
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-slate-950 shadow-sm transition focus:border-blue-500"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">Role</span>
              <select
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-slate-950 shadow-sm"
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            {error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            {successMessage ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {successMessage}
              </div>
            ) : null}

            <button
              className="w-full rounded-md bg-blue-600 px-4 py-2.5 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              type="submit"
              disabled={submitting}
            >
              {submitting ? "Creating..." : "Create User"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
