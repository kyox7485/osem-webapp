import Link from "next/link";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { SignOutButton } from "@/components/sign-out-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const account = await getCurrentUser();

  if (!account) {
    // Authenticated in Supabase Auth but no matching tbl_user_accounts row
    // -- can't do anything useful in the app (branch_id/rights come from
    // there). Rendered inline rather than redirected: redirecting to
    // /login would bounce right back here (middleware sends an
    // authenticated user away from /login), causing an infinite redirect
    // loop / blank page.
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="mb-2 text-lg font-semibold text-gray-900">Account not set up</h1>
          <p className="mb-6 text-sm text-gray-500">
            You&apos;re signed in, but this login isn&apos;t linked to a user account yet.
            Ask an admin to add you under Accounts, then sign out and back in.
          </p>
          <SignOutButton />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <nav className="flex items-center gap-6">
            <span className="font-semibold text-gray-900">OSEM</span>
            <Link href="/residents" className="text-sm text-gray-600 hover:text-gray-900">
              Residents
            </Link>
            <Link href="/staff" className="text-sm text-gray-600 hover:text-gray-900">
              Staff
            </Link>
            {isAdmin(account) && (
              <Link href="/accounts" className="text-sm text-gray-600 hover:text-gray-900">
                Accounts
              </Link>
            )}
          </nav>
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <span>
              {account.username} · {account.branch_name || "All branches"} · {account.rights}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
