"use client";

import { useState } from "react";
import { createVital } from "./vitals-actions";
import type { LookupOption } from "@/lib/types";
import type { ClinicalLookups } from "@/lib/lookups";
import { useTranslation } from "@/components/language-provider";

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

const SPO2_CONDITION_OPTIONS = [
  "under RA",
  "under 1LPM O2",
  "under 2LPM O2",
  "under 3LPM O2",
  "under 4LPM O2",
  "under 5LPM O2",
  "under 6LPM O2",
  "under 7LPM O2",
  "under 8LPM O2",
  "under 9LPM O2",
  "under 10LPM O2",
];

const DXT_REMARK_OPTIONS = ["Fasting", "Post-Meal 1hr", "Post-Meal 2hr", "Post-Meal >4hr"];

export function NewVitalForm({ residents, allStaff, lookups, onClose, onSaved }: Props) {
  const t = useTranslation();
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
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const selectedResidentBranchId = residents.find((r) => String(r.id) === residentId)?.branch_id;
  const staffOptions = allStaff.filter((s) => s.branch_id === selectedResidentBranchId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!residentId) {
      setError(t("Please select a resident"));
      return;
    }

    if (!reviewedBy) {
      setError(t("Please select who reviewed this reading"));
      return;
    }

    // Validate SpO2 condition when SpO2 is filled
    if (spo2 && !spo2Condition) {
      setError(t("SpO2 condition is required when SpO2 is recorded"));
      return;
    }

    // Validate DXT remark when DXT is filled
    if (dxt && !dxtRemark) {
      setError(t("DXT remark is required when DXT is recorded"));
      return;
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
      reviewedBy,
    });

    setIsSaving(false);

    if (!result.success) {
      setError(result.error || t("Failed to save vital signs"));
      return;
    }

    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">{t("Record Vital Signs")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            disabled={isSaving}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="resident" className="mb-1 block text-sm font-medium text-gray-700">
              {t("Resident")} <span className="text-red-500">*</span>
            </label>
            <select
              id="resident"
              value={residentId}
              onChange={(e) => {
                setResidentId(e.target.value);
                setReviewedBy("");
              }}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
              <label htmlFor="systolic-bp" className="mb-1 block text-sm font-medium text-gray-700">
                {t("Systolic BP (mmHg)")}
              </label>
              <input
                type="number"
                id="systolic-bp"
                value={systolicBp}
                onChange={(e) => setSystolicBp(e.target.value)}
                step="0.1"
                placeholder={t("e.g. 120")}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="diastolic-bp" className="mb-1 block text-sm font-medium text-gray-700">
                {t("Diastolic BP (mmHg)")}
              </label>
              <input
                type="number"
                id="diastolic-bp"
                value={diastolicBp}
                onChange={(e) => setDiastolicBp(e.target.value)}
                step="0.1"
                placeholder={t("e.g. 80")}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="heart-rate" className="mb-1 block text-sm font-medium text-gray-700">
                {t("Heart Rate (bpm)")}
              </label>
              <input
                type="number"
                id="heart-rate"
                value={heartRate}
                onChange={(e) => setHeartRate(e.target.value)}
                step="0.1"
                placeholder={t("e.g. 72")}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="temperature" className="mb-1 block text-sm font-medium text-gray-700">
                {t("Temperature (°C)")}
              </label>
              <input
                type="number"
                id="temperature"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                step="0.1"
                placeholder={t("e.g. 36.8")}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="spo2" className="mb-1 block text-sm font-medium text-gray-700">
                {t("SpO2 (%)")}
              </label>
              <input
                type="number"
                id="spo2"
                value={spo2}
                onChange={(e) => setSpo2(e.target.value)}
                step="0.1"
                placeholder={t("e.g. 98")}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {spo2 && (
              <div>
                <label htmlFor="spo2-condition" className="mb-1 block text-sm font-medium text-gray-700">
                  {t("SpO2 Condition")} <span className="text-red-500">*</span>
                </label>
                <select
                  id="spo2-condition"
                  value={spo2Condition}
                  onChange={(e) => setSpo2Condition(e.target.value)}
                  required
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
              <label htmlFor="dxt" className="mb-1 block text-sm font-medium text-gray-700">
                {t("DXT (mmol/L)")}
              </label>
              <input
                type="number"
                id="dxt"
                value={dxt}
                onChange={(e) => setDxt(e.target.value)}
                step="0.1"
                placeholder={t("e.g. 5.5")}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {dxt && (
              <div>
                <label htmlFor="dxt-remark" className="mb-1 block text-sm font-medium text-gray-700">
                  {t("DXT Remark")} <span className="text-red-500">*</span>
                </label>
                <select
                  id="dxt-remark"
                  value={dxtRemark}
                  onChange={(e) => setDxtRemark(e.target.value)}
                  required
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
              <label htmlFor="insulin-adjustment" className="mb-1 block text-sm font-medium text-gray-700">
                {t("Insulin Adjustment")}
              </label>
              <textarea
                id="insulin-adjustment"
                value={insulinAdjustment}
                onChange={(e) => setInsulinAdjustment(e.target.value)}
                rows={2}
                placeholder={t("Notes on insulin adjustment...")}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-800">{t("Advanced Observation")}</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="respiration-rate" className="mb-1 block text-sm font-medium text-gray-700">
                  {t("Respiration Rate (breaths/min)")}
                </label>
                <input
                  type="number"
                  id="respiration-rate"
                  value={respirationRate}
                  onChange={(e) => setRespirationRate(e.target.value)}
                  step="0.1"
                  placeholder={t("e.g. 16")}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label htmlFor="avpu" className="mb-1 block text-sm font-medium text-gray-700">
                  {t("AVPU")}
                </label>
                <select
                  id="avpu"
                  value={avpuId}
                  onChange={(e) => setAvpuId(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                <label htmlFor="gcs-eye" className="mb-1 block text-sm font-medium text-gray-700">
                  {t("GCS Eye")}
                </label>
                <select
                  id="gcs-eye"
                  value={gcsEyeId}
                  onChange={(e) => setGcsEyeId(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                <label htmlFor="gcs-verbal" className="mb-1 block text-sm font-medium text-gray-700">
                  {t("GCS Verbal")}
                </label>
                <select
                  id="gcs-verbal"
                  value={gcsVerbalId}
                  onChange={(e) => setGcsVerbalId(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                <label htmlFor="gcs-motor" className="mb-1 block text-sm font-medium text-gray-700">
                  {t("GCS Motor")}
                </label>
                <select
                  id="gcs-motor"
                  value={gcsMotorId}
                  onChange={(e) => setGcsMotorId(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
          </div>

          <div>
            <label htmlFor="reviewed-by" className="mb-1 block text-sm font-medium text-gray-700">
              {t("Reviewed By")} <span className="text-red-500">*</span>
            </label>
            <select
              id="reviewed-by"
              value={reviewedBy}
              onChange={(e) => setReviewedBy(e.target.value)}
              required
              disabled={!residentId}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100"
            >
              <option value="">{t("Select staff")}</option>
              {staffOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {t("Cancel")}
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {isSaving ? t("Saving...") : t("Save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
