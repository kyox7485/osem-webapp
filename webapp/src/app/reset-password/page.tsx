"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/components/language-provider";

export default function ResetPasswordPage() {
  const router = useRouter();
  const t = useTranslation();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // The invite/recovery link can hand off a session in three different
    // shapes depending on how Supabase's mail server delivered it --
    // #access_token=... in the URL fragment (implicit flow, picked up
    // automatically by detectSessionInUrl), ?token_hash=...&type=... (OTP
    // style, needs verifyOtp), or ?code=... (PKCE, needs
    // exchangeCodeForSession). Handle all three rather than assume one --
    // this is what was silently failing invite links that arrived in a
    // shape the old implicit-only check never handled.
    const supabase = createClient();

    async function establishSession() {
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get("token_hash");
      const type = params.get("type") as EmailOtpType | null;
      const code = params.get("code");

      if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
        if (error) {
          setError(t("This invite/reset link is invalid or has expired. Request a new one."));
          return;
        }
        setReady(true);
        return;
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setError(t("This invite/reset link is invalid or has expired. Request a new one."));
          return;
        }
        setReady(true);
        return;
      }

      // Neither query param is present -- fall back to checking whether
      // detectSessionInUrl already picked up an implicit-flow hash fragment.
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setReady(true);
      } else {
        setError(t("This reset link is invalid or has expired. Request a new one from the login page."));
      }
    }

    establishSession();
    // Runs once on mount to consume the invite/recovery link -- must not
    // re-run when the user switches language, which would attempt to
    // re-verify an already-consumed token and show a false "expired" error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setError(t("Password must be at least 6 characters."));
      return;
    }
    if (password !== confirm) {
      setError(t("Passwords don't match."));
      return;
    }
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setDone(true);
    setTimeout(() => {
      router.push("/residents");
      router.refresh();
    }, 1500);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-gray-900">{t("Set a new password")}</h1>

        {done ? (
          <p className="text-sm text-green-700">{t("Password updated. Redirecting...")}</p>
        ) : !ready ? (
          <p className="text-sm text-gray-500">{error ?? t("Checking your reset link...")}</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                {t("New password")}
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label htmlFor="confirm" className="block text-sm font-medium text-gray-700">
                {t("Confirm password")}
              </label>
              <input
                id="confirm"
                type="password"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? t("Saving...") : t("Set new password")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
