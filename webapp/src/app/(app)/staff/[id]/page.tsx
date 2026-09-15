import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { formatBranch } from "@/lib/lookups";

export default async function StaffViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const currentUser = await getCurrentUser();

  const { data: staff } = await supabase
    .from("tbl_staff")
    .select("*, tbl_positions(name), tbl_branches(locale:BranchLocale, code:BranchCode)")
    .eq("StaffID", id)
    .single();

  if (!staff) notFound();

  const position = Array.isArray(staff.tbl_positions) ? staff.tbl_positions[0] : staff.tbl_positions;
  const branch = Array.isArray(staff.tbl_branches) ? staff.tbl_branches[0] : staff.tbl_branches;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{staff.staff_name}</h1>
          <p className="text-sm text-gray-500">{position?.name} · {formatBranch(branch)}</p>
        </div>
        {isAdmin(currentUser) && (
          <Link
            href={`/staff/${staff.StaffID}/edit`}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
          >
            Edit
          </Link>
        )}
      </div>

      <div className="max-w-md rounded-md border border-gray-200 bg-white p-4 shadow-sm">
        <dl className="space-y-2 text-sm">
          <Row label="Staff ID" value={staff.StaffID} />
          <Row label="Role" value={staff.role} />
          <Row label="Department" value={staff.department} />
          <Row label="Status" value={staff.status} />
        </dl>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="text-gray-800">{value ?? "--"}</dd>
    </div>
  );
}
