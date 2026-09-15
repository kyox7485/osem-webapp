import Link from "next/link";
import { getCurrentStaff } from "@/lib/current-staff";
import { SignOutButton } from "@/components/sign-out-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staff = await getCurrentStaff();

  if (!staff) {
    // Authenticated in Supabase Auth but no matching tbl_staff row -- can't
    // do anything useful in the app (branch_id/role come from tbl_staff).
    // Rendered inline rather than redirected: redirecting to /login would
    // bounce right back here (middleware sends an authenticated user away
    // from /login), causing an infinite redirect loop / blank page.
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="mb-2 text-lg font-semibold text-gray-900">Account not set up</h1>
          <p className="mb-6 text-sm text-gray-500">
            You&apos;re signed in, but this account isn&apos;t linked to a staff record yet.
            Ask an admin to add you under Staff, then sign out and back in.
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
          </nav>
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <span>
              {staff.staff_name} · {staff.branch_name || "All branches"} · {staff.role}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
