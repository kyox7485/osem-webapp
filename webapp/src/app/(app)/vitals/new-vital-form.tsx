"use client";

import { useState } from "react";
import { createVital } from "./actions";
import type { LookupOption } from "@/lib/types";

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

export function NewVitalForm({ residents, allStaff, onClose, onSaved }: Props) {
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
  const [reviewedBy, setReviewedBy] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const selectedResidentBranchId = residents.find((r) => String(r.id) === residentId)?.branch_id;
  const staffOptions = allStaff.filter((s) => s.branch_id === selectedResidentBranchId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!residentId) {
      setError("Please select a resident");
      return;
    }

    // Validate SpO2 condition when SpO2 is filled
    if (spo2 && !spo2Condition) {
      setError("SpO2 condition is required when SpO2 is recorded");
      return;
    }

    // Validate DXT remark when DXT is filled
    if (dxt && !dxtRemark) {
      setError("DXT remark is required when DXT is recorded");
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
      reviewedBy: reviewedBy || null,
    });

    setIsSaving(false);

    if (!result.success) {
      setError(result.error || "Failed to save vital signs");
      return;
    }

    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Record Vital Signs</h2>
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
              Resident <span className="text-red-500">*</span>
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
              <option value="">Select resident</option>
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
                Systolic BP (mmHg)
              </label>
              <input
                type="number"
                id="systolic-bp"
                value={systolicBp}
                onChange={(e) => setSystolicBp(e.target.value)}
                step="0.1"
                placeholder="e.g. 120"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="diastolic-bp" className="mb-1 block text-sm font-medium text-gray-700">
                Diastolic BP (mmHg)
              </label>
              <input
                type="number"
                id="diastolic-bp"
                value={diastolicBp}
                onChange={(e) => setDiastolicBp(e.target.value)}
                step="0.1"
                placeholder="e.g. 80"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="heart-rate" className="mb-1 block text-sm font-medium text-gray-700">
                Heart Rate (bpm)
              </label>
              <input
                type="number"
                id="heart-rate"
                value={heartRate}
                onChange={(e) => setHeartRate(e.target.value)}
                step="0.1"
                placeholder="e.g. 72"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="temperature" className="mb-1 block text-sm font-medium text-gray-700">
                Temperature (°C)
              </label>
              <input
                type="number"
                id="temperature"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                step="0.1"
                placeholder="e.g. 36.8"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="spo2" className="mb-1 block text-sm font-medium text-gray-700">
                SpO2 (%)
              </label>
              <input
                type="number"
                id="spo2"
                value={spo2}
                onChange={(e) => setSpo2(e.target.value)}
                step="0.1"
                placeholder="e.g. 98"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="spo2-condition" className="mb-1 block text-sm font-medium text-gray-700">
                SpO2 Condition {spo2 && <span className="text-red-500">*</span>}
              </label>
              <select
                id="spo2-condition"
                value={spo2Condition}
                onChange={(e) => setSpo2Condition(e.target.value)}
                required={!!spo2}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">Select condition</option>
                {SPO2_CONDITION_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="dxt" className="mb-1 block text-sm font-medium text-gray-700">
                DXT (mmol/L)
              </label>
              <input
                type="number"
                id="dxt"
                value={dxt}
                onChange={(e) => setDxt(e.target.value)}
                step="0.1"
                placeholder="e.g. 5.5"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="dxt-remark" className="mb-1 block text-sm font-medium text-gray-700">
                DXT Remark {dxt && <span className="text-red-500">*</span>}
              </label>
              <select
                id="dxt-remark"
                value={dxtRemark}
                onChange={(e) => setDxtRemark(e.target.value)}
                required={!!dxt}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">Select remark</option>
                {DXT_REMARK_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="insulin-adjustment" className="mb-1 block text-sm font-medium text-gray-700">
              Insulin Adjustment
            </label>
            <textarea
              id="insulin-adjustment"
              value={insulinAdjustment}
              onChange={(e) => setInsulinAdjustment(e.target.value)}
              rows={2}
              placeholder="Notes on insulin adjustment..."
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label htmlFor="reviewed-by" className="mb-1 block text-sm font-medium text-gray-700">
              Reviewed By
            </label>
            <select
              id="reviewed-by"
              value={reviewedBy}
              onChange={(e) => setReviewedBy(e.target.value)}
              disabled={!residentId}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100"
            >
              <option value="">Select staff</option>
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
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
