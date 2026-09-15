"use client";

import { useState } from "react";
import { setAccountPassword } from "@/app/(app)/accounts/actions";

export function SetPasswordForm({ accountId }: { accountId: number }) {
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
    <form action={handleSubmit} className="max-w-lg space-y-3 rounded-md border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-medium text-gray-900">Set new password</h2>
      <p className="text-xs text-gray-400">
        Sets it directly -- no email involved. Not stored anywhere; tell the person once.
      </p>

      <input
        name="password"
        type="text"
        required
        minLength={6}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="New password (min 6 characters)"
        className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-700">Password updated.</p>}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {submitting ? "Saving..." : "Set password"}
      </button>
    </form>
  );
}
