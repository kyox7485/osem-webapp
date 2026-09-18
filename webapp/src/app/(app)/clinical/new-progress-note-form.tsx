"use client";

import { useState, useEffect } from "react";
import { createProgressNote, getResidentDashboardData, type ResidentDashboardData } from "./progress-notes-actions";
import { ResidentDashboard } from "./resident-dashboard";
import type { LookupOption } from "@/lib/types";
import { useTranslation } from "@/components/language-provider";

type Resident = {
  id: number;
  resident_name: string;
  branch_id: number;
};

type Props = {
  residents: Resident[];
  allStaff: (LookupOption & { branch_id: number })[];
  // Pre-selects and locks the resident picker -- used when the Review tab's
  // resident filter is already set, so "New entry" doesn't ask again.
  presetResidentId?: string;
  onSaved: () => void;
};

export function NewProgressNoteForm({ residents, allStaff, presetResidentId, onSaved }: Props) {
  const t = useTranslation();
  const [residentId, setResidentId] = useState(presetResidentId || "");
  const [progressNote, setProgressNote] = useState("");
  const [physicalExamination, setPhysicalExamination] = useState("");
  const [medicalPlan, setMedicalPlan] = useState("");
  const [nursingPlan, setNursingPlan] = useState("");
  const [feedingPlan, setFeedingPlan] = useState("");
  const [monitoringPlan, setMonitoringPlan] = useState("");
  const [dressingPlan, setDressingPlan] = useState("");
  const [physioPlan, setPhysioPlan] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [dashboard, setDashboard] = useState<ResidentDashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  const selectedResidentBranchId = residents.find((r) => String(r.id) === residentId)?.branch_id;
  const staffOptions = allStaff.filter((s) => s.branch_id === selectedResidentBranchId);

  useEffect(() => {
    if (!residentId) {
      setDashboard(null);
      return;
    }
    setDashboardLoading(true);
    getResidentDashboardData(parseInt(residentId))
      .then(setDashboard)
      .finally(() => setDashboardLoading(false));
  }, [residentId]);

  function resetForm() {
    setProgressNote("");
    setPhysicalExamination("");
    setMedicalPlan("");
    setNursingPlan("");
    setFeedingPlan("");
    setMonitoringPlan("");
    setDressingPlan("");
    setPhysioPlan("");
    setCreatedBy("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!residentId) {
      setError(t("Please select a resident"));
      return;
    }

    if (!progressNote) {
      setError(t("Progress note is required"));
      return;
    }

    if (!createdBy) {
      setError(t("Please select who entered this note"));
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
      createdBy,
    });

    setIsSaving(false);

    if (!result.success) {
      setError(result.error || t("Failed to save progress note"));
      return;
    }

    resetForm();
    onSaved();
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="resident" className="mb-1 block text-sm font-medium text-gray-700">
          {t("Resident")} <span className="text-red-500">*</span>
        </label>
        <select
          id="resident"
          value={residentId}
          onChange={(e) => {
            setResidentId(e.target.value);
            setCreatedBy("");
          }}
          disabled={!!presetResidentId}
          required
          className="w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100"
        >
          <option value="">{t("Select resident")}</option>
          {residents.map((r) => (
            <option key={r.id} value={r.id}>
              {r.resident_name}
            </option>
          ))}
        </select>
      </div>

      {residentId && dashboardLoading && (
        <p className="text-sm text-gray-400">{t("Loading resident background...")}</p>
      )}

      {residentId && dashboard && <ResidentDashboard {...dashboard} collapsible />}

      <form onSubmit={handleSubmit} className="space-y-4 rounded-md border border-gray-200 bg-white p-4 shadow-sm">
        {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        <div>
          <label htmlFor="progress-note" className="mb-1 block text-sm font-medium text-gray-700">
            {t("Progress Note")} <span className="text-red-500">*</span>
          </label>
          <textarea
            id="progress-note"
            value={progressNote}
            onChange={(e) => setProgressNote(e.target.value)}
            required
            rows={4}
            placeholder={t("Patient progress, observations, and clinical notes...")}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="grid grid-cols-1 gap-4">
          <div>
            <label htmlFor="physical-examination" className="mb-1 block text-sm font-medium text-gray-700">
              {t("Physical Examination")}
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
              {t("Medical / Treatment Plan")}
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
              {t("Nursing Plan")}
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
              {t("Feeding / Diet Plan")}
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
              {t("Monitoring Plan")}
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
              {t("Dressing Plan")}
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
              {t("Physio Plan")}
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
              {t("Entered By")} <span className="text-red-500">*</span>
            </label>
            <select
              id="created-by"
              value={createdBy}
              onChange={(e) => setCreatedBy(e.target.value)}
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
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={resetForm}
            disabled={isSaving}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {t("Clear")}
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
  );
}
