import { redirect } from "next/navigation";
import { StaffForm } from "@/components/staff-form";
import { BackButton } from "@/components/back-button";
import { getPositions, getBranches } from "@/lib/lookups";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { createStaff } from "../actions";

export default async function NewStaffPage() {
  const currentUser = await getCurrentUser();
  if (!isAdmin(currentUser)) redirect("/staff");

  const [positions, branches] = await Promise.all([getPositions(), getBranches()]);

  return (
    <div>
      <BackButton />
      <h1 className="mb-4 text-lg font-semibold text-gray-900">New staff</h1>
      <StaffForm positions={positions} branches={branches} action={createStaff} />
    </div>
  );
}
