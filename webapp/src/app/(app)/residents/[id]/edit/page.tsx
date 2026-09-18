import { notFound } from "next/navigation";
import { ResidentForm } from "@/components/resident-form";
import { getNationalities, getDietTypes, getFeedingTypes, getBranches, getAllStaffWithBranch } from "@/lib/lookups";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { createClient } from "@/lib/supabase/server";
import type { Resident } from "@/lib/types";
import { updateResident } from "../../actions";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";

export default async function EditResidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getServerTranslator();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: resident }, currentUser, nationalities, dietTypes, feedingTypes, branches, allStaff] = await Promise.all([
    supabase.from("tbl_residents").select("*").eq("id", id).single(),
    getCurrentUser(),
    getNationalities(),
    getDietTypes(),
    getFeedingTypes(),
    getBranches("NUR"),
    getAllStaffWithBranch(),
  ]);

  if (!resident) notFound();

  const boundAction = updateResident.bind(null, resident.id);

  return (
    <div>
      <PageTitle title={`${t("Edit")} ${resident.resident_name}`} />
      <ResidentForm
        resident={resident as Resident}
        nationalities={nationalities}
        dietTypes={dietTypes}
        feedingTypes={feedingTypes}
        branches={branches}
        allStaff={allStaff}
        defaultBranchId={null}
        isAdmin={isAdmin(currentUser)}
        action={boundAction}
      />
    </div>
  );
}
