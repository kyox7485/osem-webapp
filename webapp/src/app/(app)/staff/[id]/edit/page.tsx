import { notFound, redirect } from "next/navigation";
import { StaffForm } from "@/components/staff-form";
import { getPositions, getBranches } from "@/lib/lookups";
import { getCurrentStaff, isAdmin } from "@/lib/current-staff";
import { createClient } from "@/lib/supabase/server";
import type { Staff } from "@/lib/types";
import { updateStaff } from "../../actions";

export default async function EditStaffPage({ params }: { params: Promise<{ id: string }> }) {
  const currentStaff = await getCurrentStaff();
  if (!isAdmin(currentStaff)) redirect("/staff");

  const { id } = await params;
  const supabase = await createClient();

  const [{ data: staff }, positions, branches] = await Promise.all([
    supabase.from("tbl_staff").select("*").eq("id", id).single(),
    getPositions(),
    getBranches(),
  ]);

  if (!staff) notFound();

  const boundAction = updateStaff.bind(null, staff.id);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-gray-900">Edit {staff.staff_name}</h1>
      <StaffForm staff={staff as Staff} positions={positions} branches={branches} action={boundAction} />
    </div>
  );
}
