import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/current-staff";
import { SignOutButton } from "@/components/sign-out-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staff = await getCurrentStaff();

  if (!staff) {
    // Authenticated in Supabase Auth but no matching tbl_staff row -- can't
    // do anything useful in the app (branch_id/role come from tbl_staff).
    redirect("/login?error=no-staff-record");
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
