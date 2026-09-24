"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/components/language-provider";

export default function ForgotPasswordPage() {
  const t = useTranslation();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-fg">{t("Reset your password")}</h1>
        <p className="mb-6 text-sm text-fg-subtle">
          {t("Enter your account email and we'll send you a reset link.")}
        </p>

        {sent ? (
          <div className="space-y-4">
            <p className="text-sm text-green-700 dark:text-green-300">
              {t("Check your email for a link to reset your password.")}
            </p>
            <Link href="/login" className="block text-center text-sm text-fg-subtle hover:text-fg">
              {t("Back to sign in")}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-fg-secondary">
                {t("Email")}
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? t("Sending...") : t("Send reset link")}
            </button>

            <Link href="/login" className="block text-center text-sm text-fg-subtle hover:text-fg">
              {t("Back to sign in")}
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
