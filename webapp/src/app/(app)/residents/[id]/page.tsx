import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function ResidentViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: resident } = await supabase
    .from("tbl_residents")
    .select(
      "*, tbl_branches(name), tbl_nationalities(country_name), tbl_diet_types(name), tbl_feeding_types(name)"
    )
    .eq("id", id)
    .single();

  if (!resident) notFound();

  const branch = Array.isArray(resident.tbl_branches) ? resident.tbl_branches[0] : resident.tbl_branches;
  const nationality = Array.isArray(resident.tbl_nationalities) ? resident.tbl_nationalities[0] : resident.tbl_nationalities;
  const dietType = Array.isArray(resident.tbl_diet_types) ? resident.tbl_diet_types[0] : resident.tbl_diet_types;
  const feedingType = Array.isArray(resident.tbl_feeding_types) ? resident.tbl_feeding_types[0] : resident.tbl_feeding_types;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{resident.resident_name}</h1>
          <p className="text-sm text-gray-500">{branch?.name} · {resident.status}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/residents/${resident.id}/progress-notes`}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Progress notes
          </Link>
          <Link
            href={`/residents/${resident.id}/edit`}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
          >
            Edit
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <InfoCard title="Basic details">
          <Row label="IC number" value={resident.ic_number} />
          <Row label="Age" value={resident.age} />
          <Row label="Gender" value={resident.gender} />
          <Row label="Marital status" value={resident.marital_status} />
          <Row label="Nationality" value={nationality?.country_name} />
        </InfoCard>

        <InfoCard title="Admission">
          <Row label="Care type" value={resident.care_type} />
          <Row label="Admission date" value={resident.admission_date} />
          <Row label="Discharge date" value={resident.discharge_date} />
          <Row label="Transfer from" value={resident.transfer_from} />
          <Row label="Accompanied by" value={resident.accompanied_by} />
          <Row label="Emergency contact" value={resident.emergency_contact} />
        </InfoCard>

        <InfoCard title="Care">
          <Row label="Mobility" value={resident.mobility} />
          <Row label="Hygiene" value={resident.hygiene} />
          <Row label="Diet type" value={dietType?.name} />
          <Row label="Feeding type" value={feedingType?.name} />
        </InfoCard>

        <InfoCard title="Clinical notes">
          <Row label="Allergy" value={resident.allergy} />
          <Row label="Past medical condition" value={resident.past_medical_condition} multiline />
          <Row label="Current medication list" value={resident.current_medication_list} multiline />
          <Row label="TCA notes" value={resident.tca_notes} multiline />
          <Row label="Assessment and summary" value={resident.assessment_and_summary} multiline />
        </InfoCard>
      </div>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-medium text-gray-900">{title}</h2>
      <dl className="space-y-2">{children}</dl>
    </div>
  );
}

function Row({ label, value, multiline }: { label: string; value: string | number | null | undefined; multiline?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className={`text-sm text-gray-800 ${multiline ? "whitespace-pre-wrap" : ""}`}>
        {value !== null && value !== undefined && value !== "" ? value : "--"}
      </dd>
    </div>
  );
}
