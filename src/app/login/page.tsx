"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getSupabaseClient,
  getSupabaseConfigError,
} from "@/lib/supabaseClient";
import { logActivity } from "@/lib/activityLog";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const configError = getSupabaseConfigError();
    if (configError) {
      setError(configError);
      return;
    }

    const supabase = getSupabaseClient();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace("/");
      }
    });
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const configError = getSupabaseConfigError();
    if (configError) {
      setError(configError);
      return;
    }

    setLoading(true);
    const supabase = getSupabaseClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    void logActivity({ eventType: "login", detail: { email } });

    router.replace("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f8fb] px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-soft">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-blue-600">
            Team Schedule
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">Login</h1>
          <p className="mt-2 text-sm text-slate-500">
            Use your Supabase Email / Password account.
          </p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Email</span>
            <input
              className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-slate-950 shadow-sm transition focus:border-blue-500"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Password</span>
            <input
              className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-slate-950 shadow-sm transition focus:border-blue-500"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
            />
          </label>

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <button
            className="w-full rounded-md bg-blue-600 px-4 py-2.5 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            type="submit"
            disabled={loading}
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>
      </section>
    </main>
  );
}
