import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { SignOutButton } from "@/components/sign-out-button";
import { NavLinks } from "@/components/nav-links";

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

  const navItems = [
    { href: "/residents", label: "Residents" },
    { href: "/clinical", label: "Clinical" },
    { href: "/staff", label: "Staff" },
    ...(isAdmin(account) ? [{ href: "/accounts", label: "Accounts" }] : []),
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <nav className="flex items-center gap-1">
            <span className="mr-3 flex items-center gap-1.5 font-semibold text-gray-900">
              <span className="h-2 w-2 rounded-full bg-indigo-600" />
              OSEM
            </span>
            <NavLinks items={navItems} />
          </nav>
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span className="hidden sm:inline">
              <span className="font-medium text-gray-700">{account.username}</span>
              {" · "}
              {account.branch_name || "All branches"}
              {" · "}
            </span>
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
              {account.rights}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
