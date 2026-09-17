"use client";

import { useState } from "react";
import { createNursingChartEntry } from "./nursing-chart-actions";
import { toDatetimeLocalValue, fromDatetimeLocalValue } from "@/lib/format-date";
import type { LookupOption } from "@/lib/types";
import type { NursingChartLookups } from "@/lib/lookups";

type Resident = { id: number; resident_name: string; branch_id: number };
type Meal = { mealTypeId: string; mealPortionId: string; feedingTimeId: string };

type Props = {
  residents: Resident[];
  allStaff: (LookupOption & { branch_id: number })[];
  lookups: NursingChartLookups;
  presetResidentId?: string;
  onSaved: () => void;
};

const fieldCls =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const emptyMeal: Meal = { mealTypeId: "", mealPortionId: "", feedingTimeId: "" };

export function NewNursingChartForm({ residents, allStaff, lookups, presetResidentId, onSaved }: Props) {
  const [residentId, setResidentId] = useState(presetResidentId || "");
  const [entryTimestamp, setEntryTimestamp] = useState(toDatetimeLocalValue(new Date().toISOString()));
  const [tubeFeeding, setTubeFeeding] = useState<"" | "Oral Feed" | "Tube Feeding">("");
  const [meals, setMeals] = useState<Meal[]>([{ ...emptyMeal }]);
  const [bowelOutputIds, setBowelOutputIds] = useState<number[]>([]);
  const [passUrineIds, setPassUrineIds] = useState<number[]>([]);
  const [fluidInput, setFluidInput] = useState("");
  const [fluidOutput, setFluidOutput] = useState("");
  const [cbdDrainage, setCbdDrainage] = useState("");
  const [activityIds, setActivityIds] = useState<number[]>([]);
  const [disturbanceLevelIds, setDisturbanceLevelIds] = useState<number[]>([]);
  const [psychoSocialIds, setPsychoSocialIds] = useState<number[]>([]);
  const [activeComplaintIds, setActiveComplaintIds] = useState<number[]>([]);
  const [bySelfIds, setBySelfIds] = useState<number[]>([]);
  const [withAssistIds, setWithAssistIds] = useState<number[]>([]);
  const [respirationRate, setRespirationRate] = useState("");
  const [gcsEyeId, setGcsEyeId] = useState("");
  const [gcsVerbalId, setGcsVerbalId] = useState("");
  const [gcsMotorId, setGcsMotorId] = useState("");
  const [avpuId, setAvpuId] = useState("");
  const [intervention, setIntervention] = useState("");
  const [doctorsPlan, setDoctorsPlan] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [reviewedBy, setReviewedBy] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const selectedResidentBranchId = residents.find((r) => String(r.id) === residentId)?.branch_id;
  const staffOptions = allStaff.filter((s) => s.branch_id === selectedResidentBranchId);
  const selfActivities = lookups.hygieneCareActivities.filter((a) => a.category === "Self Toileting");
  const assistedActivities = lookups.hygieneCareActivities.filter((a) => a.category === "Assisted Hygiene");

  function resetForm() {
    setTubeFeeding("");
    setMeals([{ ...emptyMeal }]);
    setBowelOutputIds([]);
    setPassUrineIds([]);
    setFluidInput("");
    setFluidOutput("");
    setCbdDrainage("");
    setActivityIds([]);
    setDisturbanceLevelIds([]);
    setPsychoSocialIds([]);
    setActiveComplaintIds([]);
    setBySelfIds([]);
    setWithAssistIds([]);
    setRespirationRate("");
    setGcsEyeId("");
    setGcsVerbalId("");
    setGcsMotorId("");
    setAvpuId("");
    setIntervention("");
    setDoctorsPlan("");
    setCreatedBy("");
    setReviewedBy("");
    setError("");
  }

  function updateMeal(index: number, patch: Partial<Meal>) {
    setMeals((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!residentId) {
      setError("Please select a resident");
      return;
    }
    if (!createdBy) {
      setError("Please select who entered this");
      return;
    }

    setIsSaving(true);

    const result = await createNursingChartEntry({
      residentId: parseInt(residentId, 10),
      entryTimestamp: fromDatetimeLocalValue(entryTimestamp),
      tubeFeeding: tubeFeeding || null,
      bowelOutputIds,
      passUrineIds,
      fluidInput: fluidInput ? parseFloat(fluidInput) : null,
      fluidOutput: fluidOutput ? parseFloat(fluidOutput) : null,
      cbdDrainage: cbdDrainage.trim() || null,
      activityIds,
      disturbanceLevelIds,
      psychoSocialBehaviourIds: psychoSocialIds,
      activeComplaintIds,
      respirationRate: respirationRate ? parseFloat(respirationRate) : null,
      gcsEyeId: gcsEyeId ? parseInt(gcsEyeId, 10) : null,
      gcsVerbalId: gcsVerbalId ? parseInt(gcsVerbalId, 10) : null,
      gcsMotorId: gcsMotorId ? parseInt(gcsMotorId, 10) : null,
      avpuId: avpuId ? parseInt(avpuId, 10) : null,
      intervention: intervention.trim() || null,
      doctorsPlan: doctorsPlan.trim() || null,
      createdBy,
      reviewedBy: reviewedBy || null,
      hygieneEpisodes: [
        { assistanceLevel: "By Self", activityIds: bySelfIds },
        { assistanceLevel: "With Assistance", activityIds: withAssistIds },
      ],
      meals: meals.map((m) => ({
        mealTypeId: m.mealTypeId ? parseInt(m.mealTypeId, 10) : null,
        mealPortionId: m.mealPortionId ? parseInt(m.mealPortionId, 10) : null,
        feedingTimeId: m.feedingTimeId ? parseInt(m.feedingTimeId, 10) : null,
      })),
    });

    setIsSaving(false);

    if (!result.success) {
      setError(result.error || "Failed to save entry");
      return;
    }

    resetForm();
    onSaved();
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="resident" className="mb-1 block text-sm font-medium text-gray-700">
          Resident <span className="text-red-500">*</span>
        </label>
        <select
          id="resident"
          value={residentId}
          onChange={(e) => {
            setResidentId(e.target.value);
            setCreatedBy("");
            setReviewedBy("");
          }}
          disabled={!!presetResidentId}
          required
          className={`max-w-md disabled:bg-gray-100 ${fieldCls}`}
        >
          <option value="">Select resident</option>
          {residents.map((r) => (
            <option key={r.id} value={r.id}>
              {r.resident_name}
            </option>
          ))}
        </select>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        <Section title="Entry">
          <label className="block text-sm text-gray-700">
            Date &amp; time
            <input
              type="datetime-local"
              value={entryTimestamp}
              onChange={(e) => setEntryTimestamp(e.target.value)}
              required
              className={`mt-1 ${fieldCls}`}
            />
          </label>
        </Section>

        <Section title="Feeding">
          <label className="block text-sm text-gray-700">
            Tube feeding
            <select value={tubeFeeding} onChange={(e) => setTubeFeeding(e.target.value as typeof tubeFeeding)} className={`mt-1 max-w-xs ${fieldCls}`}>
              <option value="">--</option>
              <option value="Oral Feed">Oral Feed</option>
              <option value="Tube Feeding">Tube Feeding</option>
            </select>
          </label>

          <div className="mt-3 space-y-2">
            <p className="text-sm font-medium text-gray-700">Meals</p>
            {meals.map((meal, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <select
                  value={meal.mealTypeId}
                  onChange={(e) => updateMeal(i, { mealTypeId: e.target.value })}
                  className={`w-40 ${fieldCls}`}
                >
                  <option value="">Meal type</option>
                  {lookups.mealTypes.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select
                  value={meal.mealPortionId}
                  onChange={(e) => updateMeal(i, { mealPortionId: e.target.value })}
                  className={`w-32 ${fieldCls}`}
                >
                  <option value="">Portion</option>
                  {lookups.mealPortions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select
                  value={meal.feedingTimeId}
                  onChange={(e) => updateMeal(i, { feedingTimeId: e.target.value })}
                  className={`w-28 ${fieldCls}`}
                >
                  <option value="">Time</option>
                  {lookups.feedingTimes.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {meals.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setMeals((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-xs text-gray-400 hover:text-red-600"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setMeals((prev) => [...prev, { ...emptyMeal }])}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
            >
              + Add meal
            </button>
          </div>
        </Section>

        <Section title="Elimination">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <CheckboxGroup label="Bowel output" options={lookups.bowelOutputTypes} value={bowelOutputIds} onChange={setBowelOutputIds} />
            <CheckboxGroup label="Pass urine" options={lookups.passUrineTypes} value={passUrineIds} onChange={setPassUrineIds} />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block text-sm text-gray-700">
              Fluid input (ml)
              <input type="number" step="1" value={fluidInput} onChange={(e) => setFluidInput(e.target.value)} className={`mt-1 ${fieldCls}`} />
            </label>
            <label className="block text-sm text-gray-700">
              Fluid output (ml)
              <input type="number" step="1" value={fluidOutput} onChange={(e) => setFluidOutput(e.target.value)} className={`mt-1 ${fieldCls}`} />
            </label>
            <label className="block text-sm text-gray-700">
              CBD drainage
              <input type="text" value={cbdDrainage} onChange={(e) => setCbdDrainage(e.target.value)} className={`mt-1 ${fieldCls}`} />
            </label>
          </div>
        </Section>

        <Section title="Hygiene care">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <CheckboxGroup label="By self" options={selfActivities} value={bySelfIds} onChange={setBySelfIds} />
            <CheckboxGroup label="With assistance" options={assistedActivities} value={withAssistIds} onChange={setWithAssistIds} />
          </div>
        </Section>

        <Section title="Activity &amp; behaviour">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <CheckboxGroup label="Activity" options={lookups.activities} value={activityIds} onChange={setActivityIds} />
            <CheckboxGroup label="Disturbance level" options={lookups.disturbanceLevels} value={disturbanceLevelIds} onChange={setDisturbanceLevelIds} />
            <CheckboxGroup label="Psycho-social behaviour" options={lookups.psychoSocialBehaviours} value={psychoSocialIds} onChange={setPsychoSocialIds} />
            <CheckboxGroup label="Active complaint" options={lookups.activeComplaints} value={activeComplaintIds} onChange={setActiveComplaintIds} />
          </div>
        </Section>

        <Section title="Neuro observation">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm text-gray-700">
              Respiration rate
              <input type="number" step="1" value={respirationRate} onChange={(e) => setRespirationRate(e.target.value)} className={`mt-1 ${fieldCls}`} />
            </label>
            <label className="block text-sm text-gray-700">
              GCS -- Eye
              <select value={gcsEyeId} onChange={(e) => setGcsEyeId(e.target.value)} className={`mt-1 ${fieldCls}`}>
                <option value="">--</option>
                {lookups.gcsEyeResponses.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-gray-700">
              GCS -- Verbal
              <select value={gcsVerbalId} onChange={(e) => setGcsVerbalId(e.target.value)} className={`mt-1 ${fieldCls}`}>
                <option value="">--</option>
                {lookups.gcsVerbalResponses.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-gray-700">
              GCS -- Motor
              <select value={gcsMotorId} onChange={(e) => setGcsMotorId(e.target.value)} className={`mt-1 ${fieldCls}`}>
                <option value="">--</option>
                {lookups.gcsMotorResponses.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-gray-700">
              AVPU
              <select value={avpuId} onChange={(e) => setAvpuId(e.target.value)} className={`mt-1 ${fieldCls}`}>
                <option value="">--</option>
                {lookups.avpuOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Section>

        <Section title="Notes">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm text-gray-700">
              Intervention
              <textarea value={intervention} onChange={(e) => setIntervention(e.target.value)} rows={3} className={`mt-1 ${fieldCls}`} />
            </label>
            <label className="block text-sm text-gray-700">
              Doctor&apos;s plan
              <textarea value={doctorsPlan} onChange={(e) => setDoctorsPlan(e.target.value)} rows={3} className={`mt-1 ${fieldCls}`} />
            </label>
          </div>
        </Section>

        <Section title="Attribution">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm text-gray-700">
              Entered by <span className="text-red-500">*</span>
              <select
                value={createdBy}
                onChange={(e) => setCreatedBy(e.target.value)}
                required
                disabled={!residentId}
                className={`mt-1 disabled:bg-gray-100 ${fieldCls}`}
              >
                <option value="">Select staff</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-gray-700">
              Reviewed by
              <select
                value={reviewedBy}
                onChange={(e) => setReviewedBy(e.target.value)}
                disabled={!residentId}
                className={`mt-1 disabled:bg-gray-100 ${fieldCls}`}
              >
                <option value="">--</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Section>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={resetForm}
            disabled={isSaving}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Clear
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-bold text-gray-900">{title}</h3>
      {children}
    </div>
  );
}

function CheckboxGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: LookupOption[];
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  function toggle(id: number) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <div>
      <p className="mb-1 text-sm font-medium text-gray-700">{label}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {options.map((o) => {
          const id = Number(o.id);
          return (
            <label key={o.id} className="flex items-center gap-1.5 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={value.includes(id)}
                onChange={() => toggle(id)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              {o.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}
