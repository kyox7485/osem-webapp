"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format-date";
import { createProgressNote } from "./progress-notes-actions";
import type { LookupOption } from "@/lib/types";

type Resident = {
  id: number;
  resident_name: string;
  branch_id: number;
};

type Props = {
  residents: Resident[];
  allStaff: (LookupOption & { branch_id: number })[];
  onClose: () => void;
  onSaved: () => void;
};

export function NewProgressNoteForm({ residents, allStaff, onClose, onSaved }: Props) {
  const [residentId, setResidentId] = useState("");
  const [progressNote, setProgressNote] = useState("");
  const [physicalExamination, setPhysicalExamination] = useState("");
  const [medicalPlan, setMedicalPlan] = useState("");
  const [nursingPlan, setNursingPlan] = useState("");
  const [feedingPlan, setFeedingPlan] = useState("");
  const [monitoringPlan, setMonitoringPlan] = useState("");
  const [dressingPlan, setDressingPlan] = useState("");
  const [physioPlan, setPhysioPlan] = useState("");
  const [reviewedBy, setReviewedBy] = useState("");
  const [createdBy, setCreatedBy] = useState("");
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

    if (!progressNote) {
      setError("Progress note is required");
      return;
    }

    if (!createdBy) {
      setError("Please select who created this note");
      return;
    }

    setIsSaving(true);

    const result = await createProgressNote({
      residentId: parseInt(residentId),
      progressNote,
      physicalExamination: physicalExamination || null,
      medicalPlan: medicalPlan || null,
      nursingPlan: nursingPlan || null,
      feedingPlan: feedingPlan || null,
      monitoringPlan: monitoringPlan || null,
      dressingPlan: dressingPlan || null,
      physioPlan: physioPlan || null,
      reviewedBy: reviewedBy || null,
      createdBy,
    });

    setIsSaving(false);

    if (!result.success) {
      setError(result.error || "Failed to save progress note");
      return;
    }

    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">New Medical Progress Note</h2>
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
                setCreatedBy("");
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

          <div>
            <label htmlFor="progress-note" className="mb-1 block text-sm font-medium text-gray-700">
              Progress Note <span className="text-red-500">*</span>
            </label>
            <textarea
              id="progress-note"
              value={progressNote}
              onChange={(e) => setProgressNote(e.target.value)}
              required
              rows={4}
              placeholder="Patient progress, observations, and clinical notes..."
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="physical-examination" className="mb-1 block text-sm font-medium text-gray-700">
                Physical Examination
              </label>
              <textarea
                id="physical-examination"
                value={physicalExamination}
                onChange={(e) => setPhysicalExamination(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="medical-plan" className="mb-1 block text-sm font-medium text-gray-700">
                Medical / Treatment Plan
              </label>
              <textarea
                id="medical-plan"
                value={medicalPlan}
                onChange={(e) => setMedicalPlan(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="nursing-plan" className="mb-1 block text-sm font-medium text-gray-700">
                Nursing Plan
              </label>
              <textarea
                id="nursing-plan"
                value={nursingPlan}
                onChange={(e) => setNursingPlan(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="feeding-plan" className="mb-1 block text-sm font-medium text-gray-700">
                Feeding / Diet Plan
              </label>
              <textarea
                id="feeding-plan"
                value={feedingPlan}
                onChange={(e) => setFeedingPlan(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="monitoring-plan" className="mb-1 block text-sm font-medium text-gray-700">
                Monitoring Plan
              </label>
              <textarea
                id="monitoring-plan"
                value={monitoringPlan}
                onChange={(e) => setMonitoringPlan(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="dressing-plan" className="mb-1 block text-sm font-medium text-gray-700">
                Dressing Plan
              </label>
              <textarea
                id="dressing-plan"
                value={dressingPlan}
                onChange={(e) => setDressingPlan(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="physio-plan" className="mb-1 block text-sm font-medium text-gray-700">
                Physio Plan
              </label>
              <textarea
                id="physio-plan"
                value={physioPlan}
                onChange={(e) => setPhysioPlan(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="created-by" className="mb-1 block text-sm font-medium text-gray-700">
                Created By <span className="text-red-500">*</span>
              </label>
              <select
                id="created-by"
                value={createdBy}
                onChange={(e) => setCreatedBy(e.target.value)}
                required
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
                <option value="">Select staff (optional)</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
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
