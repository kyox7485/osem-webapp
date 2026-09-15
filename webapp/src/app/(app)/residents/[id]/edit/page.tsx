import { notFound } from "next/navigation";
import { ResidentForm } from "@/components/resident-form";
import { getNationalities, getDietTypes, getFeedingTypes } from "@/lib/lookups";
import { createClient } from "@/lib/supabase/server";
import type { Resident } from "@/lib/types";
import { updateResident } from "../../actions";

export default async function EditResidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: resident }, nationalities, dietTypes, feedingTypes] = await Promise.all([
    supabase.from("tbl_residents").select("*").eq("id", id).single(),
    getNationalities(),
    getDietTypes(),
    getFeedingTypes(),
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
        action={boundAction}
      />
    </div>
  );
}
