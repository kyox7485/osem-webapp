import { notFound } from "next/navigation";
import { ResidentForm } from "@/components/resident-form";
import { getNationalities, getDietTypes, getFeedingTypes, getBranches, getAllStaffWithBranch } from "@/lib/lookups";
import { createClient } from "@/lib/supabase/server";
import type { Resident } from "@/lib/types";
import { updateResident } from "../../actions";

export default async function EditResidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: resident }, nationalities, dietTypes, feedingTypes, branches, allStaff] = await Promise.all([
    supabase.from("tbl_residents").select("*").eq("id", id).single(),
    getNationalities(),
    getDietTypes(),
    getFeedingTypes(),
    getBranches(),
    getAllStaffWithBranch(),
  ]);

  if (!resident) notFound();

  const boundAction = updateResident.bind(null, resident.id);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-gray-900">Edit {resident.resident_name}</h1>
      <ResidentForm
        resident={resident as Resident}
        nationalities={nationalities}
        dietTypes={dietTypes}
        feedingTypes={feedingTypes}
        branches={branches}
        allStaff={allStaff}
        defaultBranchId={null}
        action={boundAction}
      />
    </div>
  );
}
