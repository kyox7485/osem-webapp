import { redirect } from "next/navigation";
import { StaffForm } from "@/components/staff-form";
import { getPositions, getBranches } from "@/lib/lookups";
import { getCurrentStaff, isAdmin } from "@/lib/current-staff";
import { createStaff } from "../actions";

export default async function NewStaffPage() {
  const currentStaff = await getCurrentStaff();
  if (!isAdmin(currentStaff)) redirect("/staff");

  const [positions, branches] = await Promise.all([getPositions(), getBranches()]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-gray-900">New staff</h1>
      <StaffForm positions={positions} branches={branches} action={createStaff} />
    </div>
  );
}
