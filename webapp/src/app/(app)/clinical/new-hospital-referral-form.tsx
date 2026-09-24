"use client";

import { useState, useEffect } from "react";
import {
  createHospitalReferral,
  getResidentReferralData,
  type ResidentReferralData,
} from "./hospital-referral-actions";
import { formatDate } from "@/lib/format-date";
import { MOBILITY_OPTIONS, HYGIENE_OPTIONS, SPO2_CONDITION_OPTIONS, DXT_REMARK_OPTIONS, type LookupOption } from "@/lib/types";
import { StaffPickerWithOther, OTHERS_SENTINEL } from "@/components/staff-picker-with-other";
import type { ClinicalLookups } from "@/lib/lookups";
import { useTranslation } from "@/components/language-provider";
import { useFormDirtyTracking } from "@/lib/use-form-dirty-tracking";

type Resident = {
  id: number;
  resident_name: string;
  branch_id: number;
};

type Props = {
  residents: Resident[];
  allStaff: (LookupOption & { branch_id: number })[];
  lookups: ClinicalLookups;
  feedingTypes: LookupOption[];
  presetResidentId?: string;
  // Passed the new referral's id so the caller can immediately open its
  // printable PDF, same "save then print" flow as the legacy Access form.
  onSaved: (id: number) => void;
};

export function NewHospitalReferralForm({ residents, allStaff, lookups, feedingTypes, presetResidentId, onSaved }: Props) {
  const t = useTranslation();
  const [residentId, setResidentId] = useState(presetResidentId || "");
  const [chiefComplaints, setChiefComplaints] = useState("");
  const [systolicBp, setSystolicBp] = useState("");
  const [diastolicBp, setDiastolicBp] = useState("");
  const [heartRate, setHeartRate] = useState("");
  const [temperature, setTemperature] = useState("");
  const [spo2, setSpo2] = useState("");
  const [spo2Condition, setSpo2Condition] = useState("");
  const [dxt, setDxt] = useState("");
  const [dxtRemark, setDxtRemark] = useState("");
  const [advancedObsOpen, setAdvancedObsOpen] = useState(false);
  const [respirationRate, setRespirationRate] = useState("");
  const [gcsEyeId, setGcsEyeId] = useState("");
  const [gcsVerbalId, setGcsVerbalId] = useState("");
  const [gcsMotorId, setGcsMotorId] = useState("");
  const [avpuId, setAvpuId] = useState("");
  const [mobility, setMobility] = useState("");
  const [feeding, setFeeding] = useState("");
  const [hygiene, setHygiene] = useState("");
  const [reviewedBy, setReviewedBy] = useState("");
  const [reviewedByOtherName, setReviewedByOtherName] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [particulars, setParticulars] = useState<ResidentReferralData | null>(null);
  const [particularsLoading, setParticularsLoading] = useState(false);
  const { markDirty, markClean } = useFormDirtyTracking("hospital-referral-new", submitForm);

  const selectedResidentBranchId = residents.find((r) => String(r.id) === residentId)?.branch_id;
  const staffOptions = allStaff.filter((s) => s.branch_id === selectedResidentBranchId);

  useEffect(() => {
    if (!residentId) {
      setParticulars(null);
      setMobility("");
      setFeeding("");
      setHygiene("");
      return;
    }
    setParticularsLoading(true);
    getResidentReferralData(parseInt(residentId))
      .then((data) => {
        setParticulars(data);
        // Always carries the resident's current profile value in as the
        // starting selection -- still an editable dropdown, since the
        // ADL status at the moment of referral can differ from the
        // resident's usual baseline.
        setMobility(data?.mobility ?? "");
        setFeeding(data?.feeding ?? "");
        setHygiene(data?.hygiene ?? "");
      })
      .finally(() => setParticularsLoading(false));
  }, [residentId]);

  function resetForm() {
    setChiefComplaints("");
    setSystolicBp("");
    setDiastolicBp("");
    setHeartRate("");
    setTemperature("");
    setSpo2("");
    setSpo2Condition("");
    setDxt("");
    setDxtRemark("");
    setRespirationRate("");
    setGcsEyeId("");
    setGcsVerbalId("");
    setGcsMotorId("");
    setAvpuId("");
    setReviewedBy("");
    setReviewedByOtherName("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submitForm();
  }

  async function submitForm(): Promise<{ success: boolean; error?: string }> {
    setError("");

    if (!residentId) {
      const msg = t("Please select a resident");
      setError(msg);
      return { success: false, error: msg };
    }

    if (!chiefComplaints) {
      const msg = t("Chief complaints is required");
      setError(msg);
      return { success: false, error: msg };
    }

    if (spo2 && !spo2Condition) {
      const msg = t("SpO2 condition is required when SpO2 is recorded");
      setError(msg);
      return { success: false, error: msg };
    }

    if (dxt && !dxtRemark) {
      const msg = t("DXT remark is required when DXT is recorded");
      setError(msg);
      return { success: false, error: msg };
    }

    if (!reviewedBy || (reviewedBy === OTHERS_SENTINEL && !reviewedByOtherName.trim())) {
      const msg = t("Please select who is reporting this referral");
      setError(msg);
      return { success: false, error: msg };
    }

    const vitalSignsLines = [
      `BP: ${systolicBp || "--"}/${diastolicBp || "--"}`,
      `HR: ${heartRate || "--"}`,
      `T: ${temperature || "--"}`,
      `SpO2: ${spo2 || "--"}${spo2Condition ? ` (${spo2Condition})` : ""}`,
      `DXT: ${dxt || "--"}${dxtRemark ? ` (${dxtRemark})` : ""}`,
    ];

    if (respirationRate) vitalSignsLines.push(`Respiration Rate: ${respirationRate}`);
    if (avpuId) vitalSignsLines.push(`AVPU: ${lookups.avpuOptions.find((o) => String(o.id) === avpuId)?.label ?? "--"}`);
    if (gcsEyeId) vitalSignsLines.push(`GCS Eye: ${lookups.gcsEyeResponses.find((o) => String(o.id) === gcsEyeId)?.label ?? "--"}`);
    if (gcsVerbalId) vitalSignsLines.push(`GCS Verbal: ${lookups.gcsVerbalResponses.find((o) => String(o.id) === gcsVerbalId)?.label ?? "--"}`);
    if (gcsMotorId) vitalSignsLines.push(`GCS Motor: ${lookups.gcsMotorResponses.find((o) => String(o.id) === gcsMotorId)?.label ?? "--"}`);

    setIsSaving(true);

    const result = await createHospitalReferral({
      residentId: parseInt(residentId),
      chiefComplaints,
      vitalSigns: vitalSignsLines.join("\n"),
      mobility: mobility || null,
      feeding: feeding || null,
      hygiene: hygiene || null,
      reviewedBy: reviewedBy === OTHERS_SENTINEL ? "" : reviewedBy,
      reviewedByOther: reviewedBy === OTHERS_SENTINEL ? reviewedByOtherName.trim() : "",
    });

    setIsSaving(false);

    if (!result.success || !result.id) {
      const msg = result.error || t("Failed to save hospital referral");
      setError(msg);
      return { success: false, error: msg };
    }

    resetForm();
    markClean();
    onSaved(result.id);
    return { success: true };
  }

  return (
    <div className="space-y-4" onChangeCapture={markDirty}>
      <div>
        <label htmlFor="resident" className="mb-1 block text-sm font-medium text-fg-secondary">
          {t("Resident")} <span className="text-red-500">*</span>
        </label>
        <select
          id="resident"
          value={residentId}
          onChange={(e) => {
            setResidentId(e.target.value);
            setReviewedBy("");
            setReviewedByOtherName("");
          }}
          required
          className="w-full max-w-md rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">{t("Select resident")}</option>
          {residents.map((r) => (
            <option key={r.id} value={r.id}>
              {r.resident_name}
            </option>
          ))}
        </select>
      </div>

      {residentId && particularsLoading && (
        <p className="text-sm text-fg-faint">{t("Loading resident particulars...")}</p>
      )}

      {residentId && particulars && (
        <details className="group rounded-md border border-line bg-surface p-4 shadow-sm" open>
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold text-fg">
            {t("Resident's Particulars")}
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              className="text-fg-faint transition-transform group-open:rotate-90"
            >
              <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ParticularField label={t("IC No. / Passport No")} value={particulars.ic_number} />
            <ParticularField
              label={t("Date of Nursing Home Admission")}
              value={particulars.admission_date ? formatDate(particulars.admission_date) : null}
            />
            <ParticularField label={t("Emergency Contact")} value={particulars.emergency_contact} multiline />
            <ParticularField label={t("Allergy History")} value={particulars.allergy} multiline />
            <ParticularField label={t("Past Medical / Surgical History")} value={particulars.past_medical_condition} multiline />
            <ParticularField label={t("Current Medication List")} value={particulars.current_medication_list} multiline />
          </div>
        </details>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 rounded-md border border-line bg-surface p-4 shadow-sm">
        {error && <div className="rounded-md bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-800 dark:text-red-300">{error}</div>}

        <div>
          <label htmlFor="chief-complaints" className="mb-1 block text-sm font-medium text-fg-secondary">
            {t("Chief Complaints")} <span className="text-red-500">*</span>
          </label>
          <textarea
            id="chief-complaints"
            value={chiefComplaints}
            onChange={(e) => setChiefComplaints(e.target.value)}
            required
            rows={4}
            placeholder={t("Sudden onset chest pain, SpO2 drop, impression...")}
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-fg">{t("Vital Signs")}</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <label htmlFor="systolic-bp" className="mb-1 block text-sm font-medium text-fg-secondary">
                {t("BP Systolic")}
              </label>
              <input
                type="number"
                id="systolic-bp"
                value={systolicBp}
                onChange={(e) => setSystolicBp(e.target.value)}
                step="0.1"
                placeholder={t("e.g. 146")}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label htmlFor="diastolic-bp" className="mb-1 block text-sm font-medium text-fg-secondary">
                {t("BP Diastolic")}
              </label>
              <input
                type="number"
                id="diastolic-bp"
                value={diastolicBp}
                onChange={(e) => setDiastolicBp(e.target.value)}
                step="0.1"
                placeholder={t("e.g. 71")}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label htmlFor="heart-rate" className="mb-1 block text-sm font-medium text-fg-secondary">
                {t("HR")}
              </label>
              <input
                type="number"
                id="heart-rate"
                value={heartRate}
                onChange={(e) => setHeartRate(e.target.value)}
                step="0.1"
                placeholder={t("e.g. 102")}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label htmlFor="temperature" className="mb-1 block text-sm font-medium text-fg-secondary">
                {t("Temp (°C)")}
              </label>
              <input
                type="number"
                id="temperature"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                step="0.1"
                placeholder={t("e.g. 36.2")}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label htmlFor="spo2" className="mb-1 block text-sm font-medium text-fg-secondary">
                {t("SpO2 (%)")}
              </label>
              <input
                type="number"
                id="spo2"
                value={spo2}
                onChange={(e) => setSpo2(e.target.value)}
                step="0.1"
                placeholder={t("e.g. 92")}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            {spo2 && (
              <div>
                <label htmlFor="spo2-condition" className="mb-1 block text-sm font-medium text-fg-secondary">
                  {t("SpO2 Condition")} <span className="text-red-500">*</span>
                </label>
                <select
                  id="spo2-condition"
                  value={spo2Condition}
                  onChange={(e) => setSpo2Condition(e.target.value)}
                  required
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">{t("Select condition")}</option>
                  {SPO2_CONDITION_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {t(opt)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="dxt" className="mb-1 block text-sm font-medium text-fg-secondary">
                {t("DXT (mmol/L)")}
              </label>
              <input
                type="number"
                id="dxt"
                value={dxt}
                onChange={(e) => setDxt(e.target.value)}
                step="0.1"
                placeholder={t("e.g. 11.1")}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            {dxt && (
              <div>
                <label htmlFor="dxt-remark" className="mb-1 block text-sm font-medium text-fg-secondary">
                  {t("DXT Remark")} <span className="text-red-500">*</span>
                </label>
                <select
                  id="dxt-remark"
                  value={dxtRemark}
                  onChange={(e) => setDxtRemark(e.target.value)}
                  required
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">{t("Select remark")}</option>
                  {DXT_REMARK_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {t(opt)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="mt-3">
            <button
              type="button"
              onClick={() => setAdvancedObsOpen((o) => !o)}
              className="flex w-full items-center gap-1.5 text-left"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                className={`text-fg-faint transition-transform ${advancedObsOpen ? "rotate-90" : ""}`}
              >
                <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <h3 className="text-sm font-semibold text-fg">{t("Advanced Observation")}</h3>
            </button>
            {advancedObsOpen && (
              <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="respiration-rate" className="mb-1 block text-sm font-medium text-fg-secondary">
                    {t("Respiration Rate (breaths/min)")}
                  </label>
                  <input
                    type="number"
                    id="respiration-rate"
                    value={respirationRate}
                    onChange={(e) => setRespirationRate(e.target.value)}
                    step="0.1"
                    placeholder={t("e.g. 16")}
                    className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label htmlFor="avpu" className="mb-1 block text-sm font-medium text-fg-secondary">
                    {t("AVPU")}
                  </label>
                  <select
                    id="avpu"
                    value={avpuId}
                    onChange={(e) => setAvpuId(e.target.value)}
                    className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">{t("Select AVPU")}</option>
                    {lookups.avpuOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="gcs-eye" className="mb-1 block text-sm font-medium text-fg-secondary">
                    {t("GCS Eye")}
                  </label>
                  <select
                    id="gcs-eye"
                    value={gcsEyeId}
                    onChange={(e) => setGcsEyeId(e.target.value)}
                    className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">{t("Select response")}</option>
                    {lookups.gcsEyeResponses.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="gcs-verbal" className="mb-1 block text-sm font-medium text-fg-secondary">
                    {t("GCS Verbal")}
                  </label>
                  <select
                    id="gcs-verbal"
                    value={gcsVerbalId}
                    onChange={(e) => setGcsVerbalId(e.target.value)}
                    className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">{t("Select response")}</option>
                    {lookups.gcsVerbalResponses.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="gcs-motor" className="mb-1 block text-sm font-medium text-fg-secondary">
                    {t("GCS Motor")}
                  </label>
                  <select
                    id="gcs-motor"
                    value={gcsMotorId}
                    onChange={(e) => setGcsMotorId(e.target.value)}
                    className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">{t("Select response")}</option>
                    {lookups.gcsMotorResponses.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label htmlFor="mobility" className="mb-1 block text-sm font-medium text-fg-secondary">
              {t("Mobility")}
            </label>
            <select
              id="mobility"
              value={mobility}
              onChange={(e) => setMobility(e.target.value)}
              disabled={!residentId}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-surface-strong"
            >
              <option value="">{t("Select mobility")}</option>
              {MOBILITY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {t(opt)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="feeding" className="mb-1 block text-sm font-medium text-fg-secondary">
              {t("Feeding")}
            </label>
            <select
              id="feeding"
              value={feeding}
              onChange={(e) => setFeeding(e.target.value)}
              disabled={!residentId}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-surface-strong"
            >
              <option value="">{t("Select feeding")}</option>
              {feedingTypes.map((ft) => (
                <option key={ft.id} value={ft.label}>
                  {ft.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="hygiene" className="mb-1 block text-sm font-medium text-fg-secondary">
              {t("Hygiene")}
            </label>
            <select
              id="hygiene"
              value={hygiene}
              onChange={(e) => setHygiene(e.target.value)}
              disabled={!residentId}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-surface-strong"
            >
              <option value="">{t("Select hygiene")}</option>
              {HYGIENE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {t(opt)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="reviewed-by" className="mb-1 block text-sm font-medium text-fg-secondary">
            {t("Reported By")} <span className="text-red-500">*</span>
          </label>
          <div className="max-w-md">
          <StaffPickerWithOther
            id="reviewed-by"
            value={reviewedBy}
            otherName={reviewedByOtherName}
            onValueChange={setReviewedBy}
            onOtherNameChange={setReviewedByOtherName}
            staffOptions={staffOptions}
            disabled={!residentId}
            required
          />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={resetForm}
            disabled={isSaving}
            className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-fg-secondary hover:bg-hover focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {t("Clear")}
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isSaving ? t("Saving...") : t("Save & Generate PDF")}
          </button>
        </div>
      </form>
    </div>
  );
}

function ParticularField({ label, value, multiline }: { label: string; value: string | null; multiline?: boolean }) {
  const t = useTranslation();
  return (
    <div>
      <dt className="text-xs font-medium text-fg-subtle">{label}</dt>
      <dd className={`text-sm text-fg ${multiline ? "whitespace-pre-wrap" : ""}`}>{value || t("None recorded.")}</dd>
    </div>
  );
}
