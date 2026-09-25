import { ResidentForm } from "@/components/resident-form";
import { getNationalities, getDietTypes, getFeedingTypes, getBranches, getAllStaffWithBranch, getDiagnosisOptions, getDemoBranchIds } from "@/lib/lookups";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";
import { createResident } from "../actions";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import type { ExistingDiagnosis, Resident } from "@/lib/types";

export default async function NewResidentPage({ searchParams }: { searchParams: Promise<{ readmit_from?: string }> }) {
  const { t } = await getServerTranslator();
  const currentUser = await getCurrentUser();
  const { readmit_from } = await searchParams;

  const [nationalities, dietTypes, feedingTypes, branches, allStaff, diagnosisOptions, demoBranchIds] = await Promise.all([
    getNationalities(),
    getDietTypes(),
    getFeedingTypes(),
    getBranches("NUR"),
    getAllStaffWithBranch(),
    getDiagnosisOptions(),
    getDemoBranchIds(),
  ]);

  const isDemoUser = demoBranchIds.includes(currentUser?.branch_id ?? -1);
  const effectiveIsAdmin = canAccessAllBranches(currentUser) && !isDemoUser;

  // Readmit: fetch source resident + their diagnoses to pre-fill the form
  let prefill: Partial<Resident> | undefined;
  let prefillDiagnoses: ExistingDiagnosis[] | undefined;

  if (readmit_from) {
    const supabase = await createClient();
    const { data: src } = await supabase
      .from("tbl_residents")
      .select("*")
      .eq("id", parseInt(readmit_from, 10))
      .single();

    if (src) {
      // Copy allowed fields only — excluded: admission_date, discharge_date,
      // transfer_from, accompanied_by, assessment_and_summary, tca_notes, reviewed_by
      prefill = {
        branch_id: src.branch_id,
        resident_name: src.resident_name,
        ic_number: src.ic_number,
        age: src.age,
        nationality_id: src.nationality_id,
        gender: src.gender,
        marital_status: src.marital_status,
        care_type: src.care_type,
        emergency_contact: src.emergency_contact,
        allergy: src.allergy,
        mobility: src.mobility,
        feeding_type_id: src.feeding_type_id,
        hygiene: src.hygiene,
        diet_type_id: src.diet_type_id,
      };

      const { data: diagRows } = await supabase
        .from("tbl_resident_diagnoses")
        .select("diagnosis_option_id, remark")
        .eq("resident_id", parseInt(readmit_from, 10));

      prefillDiagnoses = (diagRows ?? []) as ExistingDiagnosis[];
    }
  }

  return (
    <div>
      <PageTitle title={readmit_from ? t("Readmit resident") : t("New resident")} />
      <ResidentForm
        prefill={prefill}
        nationalities={nationalities}
        dietTypes={dietTypes}
        feedingTypes={feedingTypes}
        branches={branches}
        allStaff={allStaff}
        diagnosisOptions={diagnosisOptions}
        existingDiagnoses={prefillDiagnoses}
        defaultBranchId={effectiveIsAdmin ? null : currentUser?.branch_id ?? null}
        isAdmin={effectiveIsAdmin}
        action={createResident}
        backHref="/residents"
      />
    </div>
  );
}
