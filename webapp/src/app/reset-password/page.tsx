"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/components/language-provider";

// True when the session's most recent authentication method (JWT `amr`
// claim) was a password sign-in rather than an emailed link.
function isPasswordLogin(accessToken: string): boolean {
  try {
    const payload = accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(payload)) as { amr?: { method: string; timestamp: number }[] };
    const latest = [...(claims.amr ?? [])].sort((a, b) => b.timestamp - a.timestamp)[0];
    return !latest || latest.method === "password";
  } catch {
    return true;
  }
}

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
    // shapes: #access_token=... in the URL fragment (admin invites --
    // inviteUserByEmail is always implicit flow), ?token_hash=...&type=...
    // (OTP style, needs verifyOtp), or ?code=... (PKCE -- what
    // resetPasswordForEmail from our browser client produces).
    //
    // Two footguns, both of which shipped once:
    // - The @supabase/ssr browser client is PKCE-mode, so it REFUSES an
    //   implicit #access_token fragment and keeps whatever session was
    //   already in the browser. Falling back to getSession() then handed
    //   the page the admin's own session (the admin who just sent the
    //   invite), and the invitee's "new password" overwrote the admin's.
    //   So the fragment is consumed explicitly via setSession, and an
    //   existing session is never trusted unless it came from a link.
    // - The client auto-exchanges ?code= during initialization. Exchanging
    //   it a second time fails (the verifier is single-use), so only
    //   exchange manually when initialization didn't already consume it.
    const supabase = createClient();
    const invalid = () =>
      setError(t("This invite/reset link is invalid or has expired. Request a new one."));

    async function establishSession() {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      if (hash.get("error") || hash.get("error_code")) {
        invalid();
        return;
      }
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        // Strip the tokens from the address bar/history either way.
        window.history.replaceState(null, "", window.location.pathname);
        if (error) {
          invalid();
          return;
        }
        setReady(true);
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get("token_hash");
      const type = params.get("type") as EmailOtpType | null;
      if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
        if (error) {
          invalid();
          return;
        }
        setReady(true);
        return;
      }

      // Waits for client initialization, which auto-exchanges ?code= and
      // strips it from the URL on success.
      const { data } = await supabase.auth.getSession();
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          invalid();
          return;
        }
        setReady(true);
        return;
      }

      // No link parameters left: only accept a session that a link
      // produced (amr = recovery/invite/otp), never a normal password
      // login that happens to be sitting in this browser.
      if (data.session && !isPasswordLogin(data.session.access_token)) {
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
    <div className="flex min-h-screen items-center justify-center bg-app px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-fg">{t("Set a new password")}</h1>

        {done ? (
          <p className="text-sm text-green-700 dark:text-green-300">{t("Password updated. Redirecting...")}</p>
        ) : !ready ? (
          <p className="text-sm text-fg-subtle">{error ?? t("Checking your reset link...")}</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-fg-secondary">
                {t("New password")}
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label htmlFor="confirm" className="block text-sm font-medium text-fg-secondary">
                {t("Confirm password")}
              </label>
              <input
                id="confirm"
                type="password"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="mt-1 w-full rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

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
