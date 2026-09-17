import { ResidentForm } from "@/components/resident-form";
import { BackButton } from "@/components/back-button";
import { getNationalities, getDietTypes, getFeedingTypes, getBranches, getAllStaffWithBranch } from "@/lib/lookups";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { createResident } from "../actions";
import { getServerTranslator } from "@/lib/i18n/server";

export default async function NewResidentPage() {
  const { t } = await getServerTranslator();
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
      <BackButton />
      <h1 className="mb-4 text-lg font-semibold text-gray-900">{t("New resident")}</h1>
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
