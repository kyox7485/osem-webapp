import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStaffRoster } from "@/lib/lookups";
import { ProgressNotesTabs } from "./progress-notes-tabs";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";

const PLAN_FIELDS = [
  ["medical", "medical_plan"],
  ["nursing", "nursing_plan"],
  ["diet", "feeding_plan"],
  ["dressing", "dressing_plan"],
  ["monitoring", "monitoring_plan"],
  ["physio", "physio_plan"],
] as const;

export default async function ProgressNotesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { t } = await getServerTranslator();

  const { data: resident } = await supabase
    .from("tbl_residents")
    .select("id, resident_name, branch_id, allergy, past_medical_condition, current_medication_list, tca_notes")
    .eq("id", id)
    .single();

  if (!resident) notFound();

  const [
    { data: notes, error: notesError },
    staffOptions,
    { data: vitals },
    { data: dxtReadings },
  ] = await Promise.all([
    supabase
      .from("tbl_progress_notes")
      // tbl_progress_notes has two FK paths to tbl_staff (reviewed_by,
      // created_by) so the join target must be named explicitly.
      .select("*, tbl_staff!created_by(staff_name)")
      .eq("resident_id", id)
      .order("entry_timestamp", { ascending: false }),
    getStaffRoster(resident.branch_id),
    // The dashboard's BP/HR/Temp/SpO2 cards plot 7 daily averages and its
    // history modal reaches back 28 days, so a fixed "last 10 rows" limit
    // (the old behaviour) couldn't support either. Vitals are charted
    // several times a day, so 28 days is well under a few hundred rows --
    // cheap to load once and filter in the browser afterwards.
    //
    // DXT is the reason this can't just be a row-count guess: the card
    // needs the latest 10 readings *that actually have a dxt value*, and
    // only ~2 of every 7 rows carry one. A separate, filtered query
    // guarantees exactly those 10 instead of hoping they fall inside the
    // main window.
    supabase
      .from("tbl_vital")
      .select("entry_timestamp, systolic_bp, diastolic_bp, heart_rate, temperature, spo2, spo2_condition, dxt, dxt_remark")
      .eq("resident_id", id)
      .order("entry_timestamp", { ascending: false })
      .limit(500),
    supabase
      .from("tbl_vital")
      .select("entry_timestamp, dxt, dxt_remark")
      .eq("resident_id", id)
      .not("dxt", "is", null)
      .order("entry_timestamp", { ascending: false })
      .limit(60),
  ]);

  // Fold the DXT-only rows into the main vitals array, de-duplicated by
  // timestamp. Any DXT reading already in `vitals` wins -- it carries the
  // full row. The extra query exists purely to reach back past the main
  // window, so its rows carry dxt only and the other columns are unknown,
  // not absent: null keeps them out of the BP/HR/Temp/SpO2 averages rather
  // than dragging them toward zero.
  const vitalsForDashboard = [
    ...(vitals ?? []),
    ...(dxtReadings ?? [])
      .filter((d) => !(vitals ?? []).some((v) => v.entry_timestamp === d.entry_timestamp))
      .map((d) => ({
        entry_timestamp: d.entry_timestamp as string,
        systolic_bp: null,
        diastolic_bp: null,
        heart_rate: null,
        temperature: null,
        spo2: null,
        spo2_condition: null,
        dxt: d.dxt as number,
        dxt_remark: (d.dxt_remark ?? null) as string | null,
      })),
  ].sort((a, b) => b.entry_timestamp.localeCompare(a.entry_timestamp));

  // Plan fields on a progress note are optional -- a doctor fills in only
  // what's relevant on a given visit -- so "last ordered X plan" means the
  // most recent note where that specific field was set, not the most
  // recent note overall.
  const plans = Object.fromEntries(
    PLAN_FIELDS.map(([key, column]) => {
      const match = notes?.find((n) => n[column]);
      return [key, match ? { entry_timestamp: match.entry_timestamp, value: match[column] as string } : null];
    })
  ) as Record<(typeof PLAN_FIELDS)[number][0], { entry_timestamp: string; value: string } | null>;

  const noteRows = (notes ?? []).map((note) => {
    const author = Array.isArray(note.tbl_staff) ? note.tbl_staff[0] : note.tbl_staff;
    return {
      id: note.id,
      entry_timestamp: note.entry_timestamp,
      progress_note: note.progress_note,
      medical_plan: note.medical_plan,
      nursing_plan: note.nursing_plan,
      authorName: author?.staff_name ?? (note as any).created_by_other ?? t("Unknown"),
    };
  });

  return (
    <div>
      <PageTitle title={t("Medical Progress Notes")} description={resident.resident_name} />
      <div className="mb-4">
        <Link href={`/residents/${resident.id}`} className="text-sm text-fg-subtle hover:underline">
          &larr; {resident.resident_name}
        </Link>
      </div>

      <ProgressNotesTabs
        residentId={resident.id}
        staffOptions={staffOptions}
        notes={noteRows}
        notesError={notesError?.message ?? null}
        dashboard={{
          allergy: resident.allergy,
          pastMedicalCondition: resident.past_medical_condition,
          currentMedicationList: resident.current_medication_list,
          tcaNotes: resident.tca_notes,
          vitals: vitalsForDashboard,
          plans,
        }}
      />
    </div>
  );
}
