import { ResidentForm } from "@/components/resident-form";
import { getNationalities, getDietTypes, getFeedingTypes } from "@/lib/lookups";
import { createResident } from "../actions";

export default async function NewResidentPage() {
  const [nationalities, dietTypes, feedingTypes] = await Promise.all([
    getNationalities(),
    getDietTypes(),
    getFeedingTypes(),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-gray-900">New resident</h1>
      <ResidentForm
        nationalities={nationalities}
        dietTypes={dietTypes}
        feedingTypes={feedingTypes}
        action={createResident}
      />
    </div>
  );
}
