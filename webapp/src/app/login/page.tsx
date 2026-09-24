"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import packageJson from "../../../package.json";
import { useTranslation } from "@/components/language-provider";

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // The demo/product-showcase login ("test") is a bare word, not a real
    // email -- Supabase Auth still needs an email-shaped identifier under
    // the hood, so it's registered as test@osemdemo.local and this maps the
    // memorable login id back to that address. Every other login already
    // types a real email, so this never touches them.
    const loginEmail = email.trim().toLowerCase() === "test" ? "test@osemdemo.local" : email;

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/residents");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-8 shadow-sm">
        <div className="flex justify-center">
          <Image src="/logo.png" alt="OSEM" width={312} height={193} className="mb-1 h-auto w-full max-w-[312px] dark:hidden" priority />
          <Image src="/logo-dark.png" alt="OSEM" width={312} height={193} className="mb-1 hidden h-auto w-full max-w-[312px] dark:block" />
        </div>
        <p className="mb-6" />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-fg-secondary">
              {t("Email")}
            </label>
            <input
              id="email"
              type="text"
              required
              autoCapitalize="none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-fg-secondary">
              {t("Password")}
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? t("Signing in...") : t("Sign in")}
          </button>

          <Link
            href="/forgot-password"
            className="block text-center text-sm text-fg-subtle hover:text-fg"
          >
            {t("Forgot password?")}
          </Link>
        </form>

        <p className="mt-6 text-center text-xs text-fg-faint">v{packageJson.version}</p>
      </div>
    </div>
  );
}
