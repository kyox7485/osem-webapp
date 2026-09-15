import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentStaff, isAdmin } from "@/lib/current-staff";

export default async function StaffViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const currentStaff = await getCurrentStaff();

  const { data: staff } = await supabase
    .from("tbl_staff")
    .select("*, tbl_positions(name), tbl_branches(name)")
    .eq("id", id)
    .single();

  if (!staff) notFound();

  const position = Array.isArray(staff.tbl_positions) ? staff.tbl_positions[0] : staff.tbl_positions;
  const branch = Array.isArray(staff.tbl_branches) ? staff.tbl_branches[0] : staff.tbl_branches;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{staff.staff_name}</h1>
          <p className="text-sm text-gray-500">{position?.name} · {branch?.name}</p>
        </div>
        {isAdmin(currentStaff) && (
          <Link
            href={`/staff/${staff.id}/edit`}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
          >
            Edit
          </Link>
        )}
      </div>

      <div className="max-w-md rounded-md border border-gray-200 bg-white p-4">
        <dl className="space-y-2 text-sm">
          <Row label="Role" value={staff.role} />
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
