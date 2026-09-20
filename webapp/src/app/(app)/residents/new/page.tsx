import { ResidentForm } from "@/components/resident-form";
import { getNationalities, getDietTypes, getFeedingTypes, getBranches, getAllStaffWithBranch, getDiagnosisOptions } from "@/lib/lookups";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { createResident } from "../actions";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";

export default async function NewResidentPage() {
  const { t } = await getServerTranslator();
  const currentUser = await getCurrentUser();
  const [nationalities, dietTypes, feedingTypes, branches, allStaff, diagnosisOptions] = await Promise.all([
    getNationalities(),
    getDietTypes(),
    getFeedingTypes(),
    getBranches("NUR"),
    getAllStaffWithBranch(),
    getDiagnosisOptions(),
  ]);

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
        defaultBranchId={isAdmin(currentUser) ? null : currentUser?.branch_id ?? null}
        isAdmin={isAdmin(currentUser)}
        action={createResident}
        backHref="/residents"
      />
    </div>
  );
}
