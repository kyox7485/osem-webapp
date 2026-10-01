import type { DiagnosisOption, ExistingDiagnosis } from "./types";
import type { Language } from "./i18n/translate";

// A resident's "known history of medical/surgical condition" lives in TWO
// places, and the split is deliberate (see schema/001_init.sql):
//
//   1. tbl_resident_diagnoses -- the coded checkbox list the admission form
//      actually collects ("Diabetes", "Hypertension", ...). This is the
//      authoritative source for anything entered through the app.
//   2. tbl_residents.past_medical_condition -- free-text narrative detail that
//      a fixed list cannot capture, populated by the Access import.
//
// Screens that read only (2) show "--" for every resident admitted through the
// form, which looks like lost data but is not. Read both, in that order.
//
// Pure and server-import-free on purpose: safe to import from a client
// component, unlike lib/lookups.ts.
export function formatMedicalHistory({
  diagnoses,
  diagnosisOptions,
  freeText,
  language,
}: {
  diagnoses: ExistingDiagnosis[];
  diagnosisOptions: DiagnosisOption[];
  freeText?: string | null;
  language?: Language;
}): string | null {
  const optionById = new Map(diagnosisOptions.map((o) => [o.id, o]));

  const coded = diagnoses
    .map((d) => {
      const opt = optionById.get(d.diagnosis_option_id);
      if (!opt) return null;
      const label = language === "ms" && opt.name_ms ? opt.name_ms : opt.name_en;
      return d.remark ? `${label} — ${d.remark}` : label;
    })
    .filter((v): v is string => v !== null);

  const narrative = freeText?.trim();
  const parts = narrative ? [...coded, narrative] : coded;
  return parts.length > 0 ? parts.join("\n") : null;
}
