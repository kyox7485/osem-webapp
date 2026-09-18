import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatBranch } from "@/lib/lookups";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";

export default async function ResidentViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getServerTranslator();
  const { id } = await params;
  const supabase = await createClient();

  const { data: resident } = await supabase
    .from("tbl_residents")
    .select(
      "*, tbl_branches(locale:BranchLocale, code:BranchCode), tbl_nationalities(country_name), tbl_diet_types(name), tbl_feeding_types(name)"
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
      <PageTitle title={resident.resident_name} description={`${formatBranch(branch)} · ${t(resident.status)}`} />
      <div className="mb-4 flex items-center justify-end">
        <div className="flex gap-2">
          <Link
            href={`/residents/${resident.id}/progress-notes`}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t("Medical Progress Notes")}
          </Link>
          <Link
            href={`/physiotherapy?type=ip&resident=${resident.id}`}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t("Physiotherapy")}
          </Link>
          <Link
            href={`/residents/${resident.id}/edit`}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
          >
            {t("Edit")}
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <InfoCard title={t("Basic details")}>
          <Row label={t("Resident ID")} value={resident.ResidentID} empty={t("--")} />
          <Row label={t("IC number")} value={resident.ic_number} empty={t("--")} />
          <Row label={t("Age")} value={resident.age} empty={t("--")} />
          <Row label={t("Gender")} value={resident.gender ? t(resident.gender) : resident.gender} empty={t("--")} />
          <Row label={t("Marital status")} value={resident.marital_status ? t(resident.marital_status) : resident.marital_status} empty={t("--")} />
          <Row label={t("Nationality")} value={nationality?.country_name} empty={t("--")} />
        </InfoCard>

        <InfoCard title={t("Admission")}>
          <Row label={t("Care type")} value={resident.care_type ? t(resident.care_type) : resident.care_type} empty={t("--")} />
          <Row label={t("Admission date")} value={resident.admission_date} empty={t("--")} />
          <Row label={t("Discharge date")} value={resident.discharge_date} empty={t("--")} />
          <Row label={t("Transfer from")} value={resident.transfer_from ? t(resident.transfer_from) : resident.transfer_from} empty={t("--")} />
          <Row label={t("Accompanied by")} value={resident.accompanied_by ? t(resident.accompanied_by) : resident.accompanied_by} empty={t("--")} />
          <Row label={t("Emergency contact")} value={resident.emergency_contact} multiline empty={t("--")} />
        </InfoCard>

        <InfoCard title={t("Care")}>
          <Row label={t("Mobility")} value={resident.mobility ? t(resident.mobility) : resident.mobility} empty={t("--")} />
          <Row label={t("Hygiene")} value={resident.hygiene ? t(resident.hygiene) : resident.hygiene} empty={t("--")} />
          <Row label={t("Diet type")} value={dietType?.name} empty={t("--")} />
          <Row label={t("Feeding type")} value={feedingType?.name} empty={t("--")} />
        </InfoCard>
      </div>

      <div className="mt-4">
        <InfoCard title={t("Clinical notes")}>
          <Row label={t("Allergy")} value={resident.allergy} empty={t("--")} />
          <Row label={t("Past medical condition")} value={resident.past_medical_condition} multiline empty={t("--")} />
          <Row label={t("Assessment and summary")} value={resident.assessment_and_summary} multiline empty={t("--")} />
          <Row label={t("Current medication list")} value={resident.current_medication_list} multiline empty={t("--")} />
          <Row label={t("TCA notes")} value={resident.tca_notes} multiline empty={t("--")} />
        </InfoCard>
      </div>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-bold text-gray-900">{title}</h2>
      <dl className="space-y-2">{children}</dl>
    </div>
  );
}

function Row({
  label,
  value,
  multiline,
  empty,
}: {
  label: string;
  value: string | number | null | undefined;
  multiline?: boolean;
  empty?: string;
}) {
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className={`text-sm text-gray-800 ${multiline ? "whitespace-pre-wrap" : ""}`}>
        {value !== null && value !== undefined && value !== "" ? value : (empty ?? "--")}
      </dd>
    </div>
  );
}
