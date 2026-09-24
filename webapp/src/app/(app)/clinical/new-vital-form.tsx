"use client";

import { useState } from "react";
import { createVital } from "./vitals-actions";
import { SPO2_CONDITION_OPTIONS, DXT_REMARK_OPTIONS, type LookupOption } from "@/lib/types";
import { StaffPickerWithOther, OTHERS_SENTINEL } from "@/components/staff-picker-with-other";
import type { ClinicalLookups } from "@/lib/lookups";
import { useTranslation } from "@/components/language-provider";
import { useFormDirtyTracking } from "@/lib/use-form-dirty-tracking";
import { useSafeNavigation } from "@/lib/use-safe-navigation";

type Resident = {
  id: number;
  resident_name: string;
  branch_id: number;
};

type Props = {
  residents: Resident[];
  // Every active staff member across all branches, with branch_id --
  // filtered client-side by the selected resident's branch, same pattern
  // as ResidentForm's "Reviewed by" picker. No per-selection network
  // round-trip (that was the old approach here, and the visible lag/flicker
  // from it was the "doesn't work like other tabs" symptom).
  allStaff: (LookupOption & { branch_id: number })[];
  lookups: ClinicalLookups;
  onClose: () => void;
  onSaved: () => void;
};

export function NewVitalForm({ residents, allStaff, lookups, onClose, onSaved }: Props) {
  const t = useTranslation();
  const [advancedObsOpen, setAdvancedObsOpen] = useState(false);
  const [residentId, setResidentId] = useState("");
  const [systolicBp, setSystolicBp] = useState("");
  const [diastolicBp, setDiastolicBp] = useState("");
  const [heartRate, setHeartRate] = useState("");
  const [temperature, setTemperature] = useState("");
  const [spo2, setSpo2] = useState("");
  const [spo2Condition, setSpo2Condition] = useState("");
  const [dxt, setDxt] = useState("");
  const [dxtRemark, setDxtRemark] = useState("");
  const [insulinAdjustment, setInsulinAdjustment] = useState("");
  const [respirationRate, setRespirationRate] = useState("");
  const [gcsEyeId, setGcsEyeId] = useState("");
  const [gcsVerbalId, setGcsVerbalId] = useState("");
  const [gcsMotorId, setGcsMotorId] = useState("");
  const [avpuId, setAvpuId] = useState("");
  const [reviewedBy, setReviewedBy] = useState("");
  const [reviewedByOtherName, setReviewedByOtherName] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const { markDirty, markClean } = useFormDirtyTracking("vital-signs-new", submitForm);
  const { guardedAction } = useSafeNavigation();

  const selectedResidentBranchId = residents.find((r) => String(r.id) === residentId)?.branch_id;
  const staffOptions = allStaff.filter((s) => s.branch_id === selectedResidentBranchId);

  function handleClose() {
    guardedAction(onClose);
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

    if (!reviewedBy || (reviewedBy === OTHERS_SENTINEL && !reviewedByOtherName.trim())) {
      const msg = t("Please select who reviewed this reading");
      setError(msg);
      return { success: false, error: msg };
    }

    // Validate SpO2 condition when SpO2 is filled
    if (spo2 && !spo2Condition) {
      const msg = t("SpO2 condition is required when SpO2 is recorded");
      setError(msg);
      return { success: false, error: msg };
    }

    // Validate DXT remark when DXT is filled
    if (dxt && !dxtRemark) {
      const msg = t("DXT remark is required when DXT is recorded");
      setError(msg);
      return { success: false, error: msg };
    }

    setIsSaving(true);

    const result = await createVital({
      residentId: parseInt(residentId),
      systolicBp: systolicBp ? parseFloat(systolicBp) : null,
      diastolicBp: diastolicBp ? parseFloat(diastolicBp) : null,
      heartRate: heartRate ? parseFloat(heartRate) : null,
      temperature: temperature ? parseFloat(temperature) : null,
      spo2: spo2 ? parseFloat(spo2) : null,
      spo2Condition: spo2Condition || null,
      dxt: dxt ? parseFloat(dxt) : null,
      dxtRemark: dxtRemark || null,
      insulinAdjustment: insulinAdjustment || null,
      respirationRate: respirationRate ? parseFloat(respirationRate) : null,
      gcsEyeId: gcsEyeId ? parseInt(gcsEyeId, 10) : null,
      gcsVerbalId: gcsVerbalId ? parseInt(gcsVerbalId, 10) : null,
      gcsMotorId: gcsMotorId ? parseInt(gcsMotorId, 10) : null,
      avpuId: avpuId ? parseInt(avpuId, 10) : null,
      reviewedBy: reviewedBy === OTHERS_SENTINEL ? "" : reviewedBy,
      reviewedByOther: reviewedBy === OTHERS_SENTINEL ? reviewedByOtherName.trim() : "",
    });

    setIsSaving(false);

    if (!result.success) {
      const msg = result.error || t("Failed to save vital signs");
      setError(msg);
      return { success: false, error: msg };
    }

    markClean();
    onSaved();
    return { success: true };
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4" onChangeCapture={markDirty}>
      <div className="flex max-h-[calc(100dvh-1rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-elevated shadow-xl sm:max-h-[calc(100dvh-2rem)]">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-line px-4 py-3 sm:px-6">
          <h2 className="text-lg font-bold text-fg sm:text-xl">{t("Record Vital Signs")}</h2>
          <button
            type="button"
            onClick={handleClose}
            className="text-fg-faint hover:text-fg-muted"
            disabled={isSaving}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="px-4 py-4 sm:px-6 sm:py-6">
            {error && <div className="mb-4 rounded-md bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-800 dark:text-red-300">{error}</div>}

            <form onSubmit={handleSubmit} className="space-y-4" id="vital-signs-form">
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
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">{t("Select resident")}</option>
              {residents.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.resident_name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="systolic-bp" className="mb-1 block text-sm font-medium text-fg-secondary">
                {t("Systolic BP (mmHg)")}
              </label>
              <input
                type="number"
                id="systolic-bp"
                value={systolicBp}
                onChange={(e) => setSystolicBp(e.target.value)}
                step="0.1"
                placeholder={t("e.g. 120")}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="diastolic-bp" className="mb-1 block text-sm font-medium text-fg-secondary">
                {t("Diastolic BP (mmHg)")}
              </label>
              <input
                type="number"
                id="diastolic-bp"
                value={diastolicBp}
                onChange={(e) => setDiastolicBp(e.target.value)}
                step="0.1"
                placeholder={t("e.g. 80")}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="heart-rate" className="mb-1 block text-sm font-medium text-fg-secondary">
                {t("Heart Rate (bpm)")}
              </label>
              <input
                type="number"
                id="heart-rate"
                value={heartRate}
                onChange={(e) => setHeartRate(e.target.value)}
                step="0.1"
                placeholder={t("e.g. 72")}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="temperature" className="mb-1 block text-sm font-medium text-fg-secondary">
                {t("Temperature (°C)")}
              </label>
              <input
                type="number"
                id="temperature"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                step="0.1"
                placeholder={t("e.g. 36.8")}
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
                placeholder={t("e.g. 98")}
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
                placeholder={t("e.g. 5.5")}
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

          {dxt && (
            <div>
              <label htmlFor="insulin-adjustment" className="mb-1 block text-sm font-medium text-fg-secondary">
                {t("Insulin Adjustment")}
              </label>
              <textarea
                id="insulin-adjustment"
                value={insulinAdjustment}
                onChange={(e) => setInsulinAdjustment(e.target.value)}
                rows={2}
                placeholder={t("Notes on insulin adjustment...")}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          )}

          <div>
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

          <div>
            <label htmlFor="reviewed-by" className="mb-1 block text-sm font-medium text-fg-secondary">
              {t("Reviewed By")} <span className="text-red-500">*</span>
            </label>
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

            </form>
          </div>
        </div>

        {/* Sticky Footer */}
        <div className="flex-shrink-0 border-t border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSaving}
              className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-fg-secondary hover:bg-hover focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {t("Cancel")}
            </button>
            <button
              type="submit"
              disabled={isSaving}
              form="vital-signs-form"
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {isSaving ? t("Saving...") : t("Save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
