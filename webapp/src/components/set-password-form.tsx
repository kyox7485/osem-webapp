"use client";

import { useState } from "react";
import { setAccountPassword } from "@/app/(app)/accounts/actions";
import { useTranslation } from "@/components/language-provider";

export function SetPasswordForm({ accountId }: { accountId: number }) {
  const t = useTranslation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    const result = await setAccountPassword(accountId, formData);
    setSubmitting(false);
    if (result && "error" in result) {
      setError(result.error);
      return;
    }
    setSuccess(true);
    setPassword("");
  }

  return (
    <form action={handleSubmit} className="max-w-lg space-y-3 rounded-md border border-line bg-surface p-4 shadow-sm">
      <h2 className="text-sm font-medium text-fg">{t("Set new password")}</h2>
      <p className="text-xs text-fg-faint">
        {t("Sets it directly -- no email involved. Not stored anywhere; tell the person once.")}
      </p>

      <input
        name="password"
        type="text"
        required
        minLength={6}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t("New password (min 6 characters)")}
        className="w-full rounded-md border border-line-strong bg-input px-3 py-1.5 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
      />

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {success && <p className="text-sm text-green-700 dark:text-green-300">{t("Password updated.")}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium text-fg-secondary hover:bg-hover disabled:opacity-50"
      >
        {submitting ? t("Saving...") : t("Set password")}
      </button>
    </form>
  );
}
