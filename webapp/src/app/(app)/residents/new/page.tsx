import { ResidentForm } from "@/components/resident-form";
import { getNationalities, getDietTypes, getFeedingTypes, getBranches, getAllStaffWithBranch } from "@/lib/lookups";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { createResident } from "../actions";

export default async function NewResidentPage() {
  const currentUser = await getCurrentUser();
  const [nationalities, dietTypes, feedingTypes, branches, allStaff] = await Promise.all([
    getNationalities(),
    getDietTypes(),
    getFeedingTypes(),
    getBranches("NUR"),
    getAllStaffWithBranch(),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-gray-900">New resident</h1>
      <ResidentForm
        nationalities={nationalities}
        dietTypes={dietTypes}
        feedingTypes={feedingTypes}
        branches={branches}
        allStaff={allStaff}
        defaultBranchId={isAdmin(currentUser) ? null : currentUser?.branch_id ?? null}
        isAdmin={isAdmin(currentUser)}
        action={createResident}
      />
    </div>
  );
}
