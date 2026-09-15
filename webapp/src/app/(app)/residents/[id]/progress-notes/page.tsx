import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStaffRoster } from "@/lib/lookups";
import { NewNoteForm } from "./new-note-form";
import { ResidentDashboard } from "./resident-dashboard";

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

  const { data: resident } = await supabase
    .from("tbl_residents")
    .select("id, resident_name, branch_id, allergy, past_medical_condition, current_medication_list")
    .eq("id", id)
    .single();

  if (!resident) notFound();

  const [{ data: notes, error: notesError }, staffOptions, { data: vitals }] = await Promise.all([
    supabase
      .from("tbl_progress_notes")
      // tbl_progress_notes has two FK paths to tbl_staff (reviewed_by,
      // created_by) so the join target must be named explicitly.
      .select("*, tbl_staff!created_by(staff_name)")
      .eq("resident_id", id)
      .order("entry_timestamp", { ascending: false }),
    getStaffRoster(resident.branch_id),
    supabase
      .from("tbl_nursing_chart_entries")
      .select("entry_timestamp, systolic_bp, diastolic_bp, heart_rate, temperature, spo2, spo2_condition")
      .eq("resident_id", id)
      .order("entry_timestamp", { ascending: false })
      .limit(10),
  ]);

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

  return (
    <div>
      <div className="mb-4">
        <Link href={`/residents/${resident.id}`} className="text-sm text-gray-500 hover:underline">
          &larr; {resident.resident_name}
        </Link>
        <h1 className="text-lg font-semibold text-gray-900">Progress notes</h1>
      </div>

      <ResidentDashboard
        allergy={resident.allergy}
        pastMedicalCondition={resident.past_medical_condition}
        currentMedicationList={resident.current_medication_list}
        vitals={vitals ?? []}
        plans={plans}
      />

      <div className="mb-4">
        <NewNoteForm residentId={resident.id} staffOptions={staffOptions} />
      </div>

      {notesError && <p className="mb-4 text-sm text-red-600">{notesError.message}</p>}

      <div className="space-y-3">
        {notes?.map((note) => {
          const author = Array.isArray(note.tbl_staff) ? note.tbl_staff[0] : note.tbl_staff;
          return (
            <div key={note.id} className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between text-xs text-gray-400">
                <span>{new Date(note.entry_timestamp).toLocaleString()}</span>
                <span>{author?.staff_name ?? "Unknown"}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-gray-800">{note.progress_note}</p>
              {note.medical_plan && (
                <p className="mt-2 text-sm text-gray-600">
                  <span className="font-medium text-gray-500">Medical plan: </span>
                  {note.medical_plan}
                </p>
              )}
              {note.nursing_plan && (
                <p className="mt-1 text-sm text-gray-600">
                  <span className="font-medium text-gray-500">Nursing plan: </span>
                  {note.nursing_plan}
                </p>
              )}
              {note.tca_notes && (
                <p className="mt-1 text-sm text-gray-600">
                  <span className="font-medium text-gray-500">TCA: </span>
                  {note.tca_notes}
                </p>
              )}
            </div>
          );
        })}
        {notes?.length === 0 && (
          <p className="rounded-md border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
            No progress notes yet.
          </p>
        )}
      </div>
    </div>
  );
}
