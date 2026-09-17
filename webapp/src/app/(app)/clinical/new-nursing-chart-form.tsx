"use client";

import { useState, useEffect } from "react";
import { createNursingChartEntry, getLastFeedingVolume } from "./nursing-chart-actions";
import { toDatetimeLocalValue, fromDatetimeLocalValue } from "@/lib/format-date";
import type { LookupOption } from "@/lib/types";
import type { ClinicalLookups } from "@/lib/lookups";

type Resident = { id: number; resident_name: string; branch_id: number };
type Meal = { mealTypeId: string; mealPortionId: string; feedingTimeId: string; feedingVolume: string };

type Props = {
  residents: Resident[];
  allStaff: (LookupOption & { branch_id: number })[];
  lookups: ClinicalLookups;
  presetResidentId?: string;
  onSaved: () => void;
};

const fieldCls =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const emptyMeal: Meal = { mealTypeId: "", mealPortionId: "", feedingTimeId: "", feedingVolume: "" };
// tbl_hygiene_care_activities ids -- when either is checked (under either
// hygiene group), something was recorded that Elimination is the place to
// detail (what came out, how much, etc.), so that section only appears then.
const CHANGE_DIAPERS_ID = 8;
const IN_OUT_CATHETER_ID = 9;

export function NewNursingChartForm({ residents, allStaff, lookups, presetResidentId, onSaved }: Props) {
  const [residentId, setResidentId] = useState(presetResidentId || "");
  const [entryTimestamp, setEntryTimestamp] = useState(toDatetimeLocalValue(new Date().toISOString()));
  const [tubeFeeding, setTubeFeeding] = useState<"" | "Oral Feed" | "Tube Feeding">("");
  const [meals, setMeals] = useState<Meal[]>([{ ...emptyMeal }]);
  const [bySelfIds, setBySelfIds] = useState<number[]>([]);
  const [withAssistIds, setWithAssistIds] = useState<number[]>([]);
  const [bowelOutputIds, setBowelOutputIds] = useState<number[]>([]);
  const [passUrineIds, setPassUrineIds] = useState<number[]>([]);
  const [fluidInput, setFluidInput] = useState("");
  const [fluidOutput, setFluidOutput] = useState("");
  const [cbdDrainage, setCbdDrainage] = useState("");
  const [activeComplaintIds, setActiveComplaintIds] = useState<number[]>([]);
  const [activityIds, setActivityIds] = useState<number[]>([]);
  const [disturbanceLevelId, setDisturbanceLevelId] = useState("");
  const [psychoSocialIds, setPsychoSocialIds] = useState<number[]>([]);
  const [intervention, setIntervention] = useState("");
  const [doctorsPlan, setDoctorsPlan] = useState("");
  const [enteredBy, setEnteredBy] = useState("");
  const [defaultFeedingVolume, setDefaultFeedingVolume] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const selectedResidentBranchId = residents.find((r) => String(r.id) === residentId)?.branch_id;
  const staffOptions = allStaff.filter((s) => s.branch_id === selectedResidentBranchId);
  const showElimination =
    bySelfIds.includes(CHANGE_DIAPERS_ID) ||
    bySelfIds.includes(IN_OUT_CATHETER_ID) ||
    withAssistIds.includes(CHANGE_DIAPERS_ID) ||
    withAssistIds.includes(IN_OUT_CATHETER_ID);

  // Carries the tube feeding regime comment forward from the resident's last
  // recorded entry, so staff amend it instead of retyping it every shift.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const volume = residentId ? await getLastFeedingVolume(parseInt(residentId, 10)) : null;
      if (cancelled) return;
      setDefaultFeedingVolume(volume);
      if (volume) {
        setMeals((prev) => (prev.length > 0 && !prev[0].feedingVolume ? [{ ...prev[0], feedingVolume: volume }, ...prev.slice(1)] : prev));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [residentId]);

  function resetForm() {
    setTubeFeeding("");
    setMeals([{ ...emptyMeal, feedingVolume: defaultFeedingVolume ?? "" }]);
    setBySelfIds([]);
    setWithAssistIds([]);
    setBowelOutputIds([]);
    setPassUrineIds([]);
    setFluidInput("");
    setFluidOutput("");
    setCbdDrainage("");
    setActiveComplaintIds([]);
    setActivityIds([]);
    setDisturbanceLevelId("");
    setPsychoSocialIds([]);
    setIntervention("");
    setDoctorsPlan("");
    setEnteredBy("");
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
    if (!enteredBy) {
      setError("Please select who entered this");
      return;
    }

    setIsSaving(true);

    const result = await createNursingChartEntry({
      residentId: parseInt(residentId, 10),
      entryTimestamp: fromDatetimeLocalValue(entryTimestamp),
      tubeFeeding: tubeFeeding || null,
      bowelOutputIds: showElimination ? bowelOutputIds : [],
      passUrineIds: showElimination ? passUrineIds : [],
      fluidInput: showElimination && fluidInput ? parseFloat(fluidInput) : null,
      fluidOutput: showElimination && fluidOutput ? parseFloat(fluidOutput) : null,
      cbdDrainage: showElimination ? cbdDrainage.trim() || null : null,
      activityIds,
      disturbanceLevelIds: disturbanceLevelId ? [parseInt(disturbanceLevelId, 10)] : [],
      psychoSocialBehaviourIds: psychoSocialIds,
      activeComplaintIds,
      // Entered by / reviewed by are the same person on this form -- one
      // picker, written to both columns (same pattern as progress notes).
      createdBy: enteredBy,
      reviewedBy: enteredBy,
      hygieneEpisodes: [
        { assistanceLevel: "By Self", activityIds: bySelfIds },
        { assistanceLevel: "With Assistance", activityIds: withAssistIds },
      ],
      meals: meals.map((m) => ({
        mealTypeId: tubeFeeding === "Tube Feeding" ? null : m.mealTypeId ? parseInt(m.mealTypeId, 10) : null,
        mealPortionId: tubeFeeding === "Tube Feeding" ? null : m.mealPortionId ? parseInt(m.mealPortionId, 10) : null,
        feedingTimeId: tubeFeeding === "Tube Feeding" ? (m.feedingTimeId ? parseInt(m.feedingTimeId, 10) : null) : null,
        feedingVolume: tubeFeeding === "Tube Feeding" ? m.feedingVolume.trim() || null : null,
      })),
      intervention: intervention.trim() || null,
      doctorsPlan: doctorsPlan.trim() || null,
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
            setEnteredBy("");
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
            Type
            <select value={tubeFeeding} onChange={(e) => setTubeFeeding(e.target.value as typeof tubeFeeding)} className={`mt-2 max-w-xs ${fieldCls}`}>
              <option value="">--</option>
              <option value="Oral Feed">Oral Feed</option>
              <option value="Tube Feeding">Tube Feeding</option>
            </select>
          </label>

          <div className="mt-3 space-y-2">
            <p className="text-sm font-medium text-gray-700">Meals</p>
            {meals.map((meal, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                {tubeFeeding === "Tube Feeding" ? (
                  <>
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
                    <input
                      type="text"
                      value={meal.feedingVolume}
                      onChange={(e) => updateMeal(i, { feedingVolume: e.target.value })}
                      placeholder="Feeding volume / regime"
                      className={`min-w-[220px] flex-1 ${fieldCls}`}
                    />
                  </>
                ) : (
                  <>
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
                  </>
                )}
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
              onClick={() => setMeals((prev) => [...prev, { ...emptyMeal, feedingVolume: defaultFeedingVolume ?? "" }])}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
            >
              + Add meal
            </button>
          </div>
        </Section>

        <Section title="Hygiene care">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <CollapsibleGroup title="By self">
              <CheckboxGroup options={lookups.hygieneCareActivities} value={bySelfIds} onChange={setBySelfIds} />
            </CollapsibleGroup>
            <CollapsibleGroup title="With assistance">
              <CheckboxGroup options={lookups.hygieneCareActivities} value={withAssistIds} onChange={setWithAssistIds} />
            </CollapsibleGroup>
          </div>
        </Section>

        {showElimination && (
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
        )}

        <Section title="Active complaint" collapsible>
          <CheckboxGroup options={lookups.activeComplaints} value={activeComplaintIds} onChange={setActiveComplaintIds} />
        </Section>

        <Section title="Activity &amp; behaviour" collapsible>
          <div className="grid grid-cols-1 gap-4">
            <CheckboxGroup label="Activity" boldLabel options={lookups.activities} value={activityIds} onChange={setActivityIds} />
            <CheckboxGroup
              label="Psycho-social behaviour"
              boldLabel
              options={lookups.psychoSocialBehaviours}
              value={psychoSocialIds}
              onChange={setPsychoSocialIds}
            />
            <label className="block text-sm text-gray-700">
              <span className="font-bold">Disturbance level</span>
              <select value={disturbanceLevelId} onChange={(e) => setDisturbanceLevelId(e.target.value)} className={`mt-2 max-w-xs ${fieldCls}`}>
                <option value="">--</option>
                {lookups.disturbanceLevels.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Section>

        <Section title="Notes" collapsible>
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
          <label className="block max-w-md text-sm text-gray-700">
            Entered by <span className="text-red-500">*</span>
            <select
              value={enteredBy}
              onChange={(e) => setEnteredBy(e.target.value)}
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

function Section({ title, collapsible, children }: { title: string; collapsible?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!collapsible);

  if (!collapsible) {
    return (
      <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-bold text-gray-900">{title}</h3>
        {children}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1.5 text-left">
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          className={`text-gray-400 transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

function CollapsibleGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-indigo-700"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          className={`text-gray-400 transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {title}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

function CheckboxGroup({
  label,
  boldLabel,
  options,
  value,
  onChange,
}: {
  label?: string;
  boldLabel?: boolean;
  options: LookupOption[];
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  function toggle(id: number) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <div>
      {label && <p className={`mb-1 text-sm text-gray-700 ${boldLabel ? "font-bold" : "font-medium"}`}>{label}</p>}
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
