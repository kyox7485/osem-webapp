import { ResidentForm } from "@/components/resident-form";
import { getNationalities, getDietTypes, getFeedingTypes, getBranches, getAllStaffWithBranch, getDiagnosisOptions, getDemoBranchIds } from "@/lib/lookups";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { createResident } from "../actions";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";

export default async function NewResidentPage() {
  const { t } = await getServerTranslator();
  const currentUser = await getCurrentUser();
  const [nationalities, dietTypes, feedingTypes, branches, allStaff, diagnosisOptions, demoBranchIds] = await Promise.all([
    getNationalities(),
    getDietTypes(),
    getFeedingTypes(),
    getBranches("NUR"),
    getAllStaffWithBranch(),
    getDiagnosisOptions(),
    getDemoBranchIds(),
  ]);

  // Demo admins must stay on their own branch — don't give them the full picker.
  const isDemoUser = demoBranchIds.includes(currentUser?.branch_id ?? -1);
  const effectiveIsAdmin = isAdmin(currentUser) && !isDemoUser;

  return (
    <div>
      <PageTitle title={t("New resident")} />
      <ResidentForm
        nationalities={nationalities}
        dietTypes={dietTypes}
        feedingTypes={feedingTypes}
        branches={branches}
        allStaff={allStaff}
        diagnosisOptions={diagnosisOptions}
        defaultBranchId={effectiveIsAdmin ? null : currentUser?.branch_id ?? null}
        isAdmin={effectiveIsAdmin}
        action={createResident}
        backHref="/residents"
      />
    </div>
  );
}
