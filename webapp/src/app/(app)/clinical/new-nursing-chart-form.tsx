"use client";

import { useState, useEffect } from "react";
import { createNursingChartEntry, getLastFeedingVolume } from "./nursing-chart-actions";
import { toDatetimeLocalValue, fromDatetimeLocalValue } from "@/lib/format-date";
import type { LookupOption } from "@/lib/types";
import type { ClinicalLookups } from "@/lib/lookups";
import { useTranslation } from "@/components/language-provider";

type Resident = { id: number; resident_name: string; branch_id: number };
type Meal = {
  mealTypeId: string;
  mealTypeOther: string;
  mealPortionId: string;
  mealPortionOther: string;
  feedingTimeId: string;
  feedingVolume: string;
};
type EliminationEpisode = { bowelOutputIds: number[]; passUrineId: string };

type Props = {
  residents: Resident[];
  allStaff: (LookupOption & { branch_id: number })[];
  lookups: ClinicalLookups;
  presetResidentId?: string;
  onSaved: () => void;
};

const fieldCls =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
// Selects get a bit more left padding than plain text inputs -- the native
// dropdown arrow eats into the right side visually, so the option text
// needs its own breathing room from the left border to read cleanly.
const selectCls =
  "w-full rounded-md border border-gray-300 pl-4 pr-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const emptyMeal: Meal = { mealTypeId: "", mealTypeOther: "", mealPortionId: "", mealPortionOther: "", feedingTimeId: "", feedingVolume: "" };
const emptyEliminationEpisode: EliminationEpisode = { bowelOutputIds: [], passUrineId: "" };
// tbl_hygiene_care_activities ids -- when any is checked (under either
// hygiene group), something was recorded that Elimination is the place to
// detail (what came out, how much, etc.), so that section only appears then.
const CHANGE_DIAPERS_ID = 8;
const IN_OUT_CATHETER_ID = 9;

// Options are seeded as "Others" / "Others:" across several lookup tables --
// matched by label rather than a hardcoded id so it keeps working if a
// table's ids ever get renumbered.
function isOthersOption(label: string): boolean {
  return label.trim().toLowerCase().startsWith("others");
}

export function NewNursingChartForm({ residents, allStaff, lookups, presetResidentId, onSaved }: Props) {
  const t = useTranslation();
  const [residentId, setResidentId] = useState(presetResidentId || "");
  const [entryTimestamp, setEntryTimestamp] = useState(toDatetimeLocalValue(new Date().toISOString()));
  const [tubeFeeding, setTubeFeeding] = useState<"" | "Oral Feed" | "Tube Feeding">("");
  const [meals, setMeals] = useState<Meal[]>([{ ...emptyMeal }]);
  const [bySelfIds, setBySelfIds] = useState<number[]>([]);
  const [withAssistIds, setWithAssistIds] = useState<number[]>([]);
  const [eliminationEpisodes, setEliminationEpisodes] = useState<EliminationEpisode[]>([{ ...emptyEliminationEpisode }]);
  const [fluidInput, setFluidInput] = useState("");
  const [fluidOutput, setFluidOutput] = useState("");
  const [cbdDrainage, setCbdDrainage] = useState("");
  const [activeComplaintIds, setActiveComplaintIds] = useState<number[]>([]);
  const [activeComplaintOther, setActiveComplaintOther] = useState("");
  const [activityIds, setActivityIds] = useState<number[]>([]);
  const [activityOther, setActivityOther] = useState("");
  const [disturbanceLevelId, setDisturbanceLevelId] = useState("");
  const [psychoSocialIds, setPsychoSocialIds] = useState<number[]>([]);
  const [psychoSocialOther, setPsychoSocialOther] = useState("");
  const [intervention, setIntervention] = useState("");
  const [doctorsPlan, setDoctorsPlan] = useState("");
  const [enteredBy, setEnteredBy] = useState("");
  const [defaultFeedingVolume, setDefaultFeedingVolume] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const selectedResidentBranchId = residents.find((r) => String(r.id) === residentId)?.branch_id;
  const staffOptions = allStaff.filter((s) => s.branch_id === selectedResidentBranchId);
  const othersActivityId = lookups.activities.find((o) => isOthersOption(o.label))?.id;
  const othersPsychoSocialId = lookups.psychoSocialBehaviours.find((o) => isOthersOption(o.label))?.id;
  const othersComplaintId = lookups.activeComplaints.find((o) => isOthersOption(o.label))?.id;
  const othersMealTypeId = lookups.mealTypes.find((o) => isOthersOption(o.label))?.id;
  const othersMealPortionId = lookups.mealPortions.find((o) => isOthersOption(o.label))?.id;
  const emptyCbdId = lookups.hygieneCareActivities.find((o) => o.label === "Empty CBD")?.id;
  const eliminationTriggerIds = [CHANGE_DIAPERS_ID, IN_OUT_CATHETER_ID, ...(emptyCbdId !== undefined ? [Number(emptyCbdId)] : [])];
  const showElimination = eliminationTriggerIds.some((id) => bySelfIds.includes(id) || withAssistIds.includes(id));
  const noneBowelOutputId = lookups.bowelOutputTypes.find((o) => o.label === "None")?.id;

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
    setEliminationEpisodes([{ ...emptyEliminationEpisode }]);
    setFluidInput("");
    setFluidOutput("");
    setCbdDrainage("");
    setActiveComplaintIds([]);
    setActiveComplaintOther("");
    setActivityIds([]);
    setActivityOther("");
    setDisturbanceLevelId("");
    setPsychoSocialIds([]);
    setPsychoSocialOther("");
    setIntervention("");
    setDoctorsPlan("");
    setEnteredBy("");
    setError("");
  }

  function updateMeal(index: number, patch: Partial<Meal>) {
    setMeals((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  function updateEliminationEpisode(index: number, patch: Partial<EliminationEpisode>) {
    setEliminationEpisodes((prev) => prev.map((ep, i) => (i === index ? { ...ep, ...patch } : ep)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!residentId) {
      setError(t("Please select a resident"));
      return;
    }
    if (!enteredBy) {
      setError(t("Please select who entered this"));
      return;
    }

    setIsSaving(true);

    const result = await createNursingChartEntry({
      residentId: parseInt(residentId, 10),
      entryTimestamp: fromDatetimeLocalValue(entryTimestamp),
      tubeFeeding: tubeFeeding || null,
      eliminationEpisodes: showElimination
        ? eliminationEpisodes
            .filter((ep) => ep.bowelOutputIds.length > 0 || ep.passUrineId)
            .map((ep) => ({ bowelOutputIds: ep.bowelOutputIds, passUrineId: ep.passUrineId ? parseInt(ep.passUrineId, 10) : null }))
        : [],
      fluidInput: showElimination && fluidInput ? parseFloat(fluidInput) : null,
      fluidOutput: showElimination && fluidOutput ? parseFloat(fluidOutput) : null,
      cbdDrainage: showElimination ? cbdDrainage.trim() || null : null,
      activityIds,
      activityOther: othersActivityId !== undefined && activityIds.includes(Number(othersActivityId)) ? activityOther.trim() || null : null,
      disturbanceLevelIds: disturbanceLevelId ? [parseInt(disturbanceLevelId, 10)] : [],
      psychoSocialBehaviourIds: psychoSocialIds,
      psychoSocialOther:
        othersPsychoSocialId !== undefined && psychoSocialIds.includes(Number(othersPsychoSocialId)) ? psychoSocialOther.trim() || null : null,
      activeComplaintIds,
      activeComplaintOther:
        othersComplaintId !== undefined && activeComplaintIds.includes(Number(othersComplaintId)) ? activeComplaintOther.trim() || null : null,
      // Entered by / reviewed by are the same person on this form -- one
      // picker, written to both columns (same pattern as progress notes).
      createdBy: enteredBy,
      reviewedBy: enteredBy,
      hygieneEpisodes: [
        { assistanceLevel: "By Self", activityIds: bySelfIds },
        { assistanceLevel: "With Assistance", activityIds: withAssistIds },
      ],
      meals: meals.map((m) => {
        const mealTypeId = tubeFeeding === "Tube Feeding" ? null : m.mealTypeId ? parseInt(m.mealTypeId, 10) : null;
        const mealPortionId = tubeFeeding === "Tube Feeding" ? null : m.mealPortionId ? parseInt(m.mealPortionId, 10) : null;
        return {
          mealTypeId,
          mealTypeOther: othersMealTypeId !== undefined && mealTypeId === Number(othersMealTypeId) ? m.mealTypeOther.trim() || null : null,
          mealPortionId,
          mealPortionOther:
            othersMealPortionId !== undefined && mealPortionId === Number(othersMealPortionId) ? m.mealPortionOther.trim() || null : null,
          feedingTimeId: tubeFeeding === "Tube Feeding" ? (m.feedingTimeId ? parseInt(m.feedingTimeId, 10) : null) : null,
          feedingVolume: tubeFeeding === "Tube Feeding" ? m.feedingVolume.trim() || null : null,
        };
      }),
      intervention: intervention.trim() || null,
      doctorsPlan: doctorsPlan.trim() || null,
    });

    setIsSaving(false);

    if (!result.success) {
      setError(result.error || t("Failed to save entry"));
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
            setEnteredBy("");
          }}
          disabled={!!presetResidentId}
          required
          className={`max-w-md disabled:bg-gray-100 ${selectCls}`}
        >
          <option value="">{t("Select resident")}</option>
          {residents.map((r) => (
            <option key={r.id} value={r.id}>
              {r.resident_name}
            </option>
          ))}
        </select>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        <Section title={t("Entry")}>
          <label className="block text-sm text-gray-700">
            {t("Date & time")}
            <input
              type="datetime-local"
              value={entryTimestamp}
              onChange={(e) => setEntryTimestamp(e.target.value)}
              required
              className={`mt-1 ${fieldCls}`}
            />
          </label>
        </Section>

        <Section title={t("Feeding")}>
          <div>
            <label className="mb-1 block text-sm text-gray-700">{t("Type")}</label>
            <select
              value={tubeFeeding}
              onChange={(e) => setTubeFeeding(e.target.value as typeof tubeFeeding)}
              className={`w-40 ${selectCls}`}
            >
              <option value="">--</option>
              <option value="Oral Feed">{t("Oral Feed")}</option>
              <option value="Tube Feeding">{t("Tube Feeding")}</option>
            </select>
          </div>

          <div className="mt-3 space-y-2">
            <p className="text-sm font-medium text-gray-700">{t("Meals")}</p>
            {meals.map((meal, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2">
                {tubeFeeding === "Tube Feeding" ? (
                  <>
                    <select
                      value={meal.feedingTimeId}
                      onChange={(e) => updateMeal(i, { feedingTimeId: e.target.value })}
                      className={`w-28 ${selectCls}`}
                    >
                      <option value="">{t("Time")}</option>
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
                      placeholder={t("Feeding volume / regime")}
                      className={`min-w-[220px] flex-1 ${fieldCls}`}
                    />
                  </>
                ) : (
                  <>
                    <div>
                      <select
                        value={meal.mealTypeId}
                        onChange={(e) => updateMeal(i, { mealTypeId: e.target.value })}
                        className={`w-40 ${selectCls}`}
                      >
                        <option value="">{t("Meal type")}</option>
                        {lookups.mealTypes.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      {othersMealTypeId !== undefined && meal.mealTypeId === String(othersMealTypeId) && (
                        <input
                          type="text"
                          value={meal.mealTypeOther}
                          onChange={(e) => updateMeal(i, { mealTypeOther: e.target.value })}
                          placeholder={t("Specify meal type")}
                          className={`mt-1 w-40 ${fieldCls}`}
                        />
                      )}
                    </div>
                    <div>
                      <select
                        value={meal.mealPortionId}
                        onChange={(e) => updateMeal(i, { mealPortionId: e.target.value })}
                        className={`w-32 ${selectCls}`}
                      >
                        <option value="">{t("Portion")}</option>
                        {lookups.mealPortions.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      {othersMealPortionId !== undefined && meal.mealPortionId === String(othersMealPortionId) && (
                        <input
                          type="text"
                          value={meal.mealPortionOther}
                          onChange={(e) => updateMeal(i, { mealPortionOther: e.target.value })}
                          placeholder={t("Specify portion")}
                          className={`mt-1 w-32 ${fieldCls}`}
                        />
                      )}
                    </div>
                  </>
                )}
                {meals.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setMeals((prev) => prev.filter((_, idx) => idx !== i))}
                    className="mt-2 text-xs text-gray-400 hover:text-red-600"
                  >
                    {t("Remove")}
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setMeals((prev) => [...prev, { ...emptyMeal, feedingVolume: defaultFeedingVolume ?? "" }])}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
            >
              + {t("Add meal")}
            </button>
          </div>
        </Section>

        <Section title={t("Hygiene care")}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <CollapsibleGroup title={t("By self")}>
              <CheckboxGroup options={lookups.hygieneCareActivities} value={bySelfIds} onChange={setBySelfIds} />
            </CollapsibleGroup>
            <CollapsibleGroup title={t("With assistance")}>
              <CheckboxGroup options={lookups.hygieneCareActivities} value={withAssistIds} onChange={setWithAssistIds} />
            </CollapsibleGroup>
          </div>
        </Section>

        {showElimination && (
          <Section title={t("Elimination")}>
            <div className="space-y-3">
              {eliminationEpisodes.map((episode, i) => (
                <div key={i} className="rounded-md border border-gray-200 p-3">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <CheckboxGroup
                      label={t("Bowel output")}
                      options={lookups.bowelOutputTypes}
                      value={episode.bowelOutputIds}
                      onChange={(ids) => updateEliminationEpisode(i, { bowelOutputIds: ids })}
                      exclusiveByGroup
                      clearAllOptionId={noneBowelOutputId !== undefined ? Number(noneBowelOutputId) : undefined}
                    />
                    <label className="block text-sm text-gray-700">
                      {t("Pass urine")}
                      <select
                        value={episode.passUrineId}
                        onChange={(e) => updateEliminationEpisode(i, { passUrineId: e.target.value })}
                        className={`mt-1 max-w-xs ${selectCls}`}
                      >
                        <option value="">--</option>
                        {lookups.passUrineTypes.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {eliminationEpisodes.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setEliminationEpisodes((prev) => prev.filter((_, idx) => idx !== i))}
                      className="mt-2 text-xs text-gray-400 hover:text-red-600"
                    >
                      {t("Remove")}
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setEliminationEpisodes((prev) => [...prev, { ...emptyEliminationEpisode }])}
                className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
              >
                + {t("Add diaper check")}
              </button>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <label className="block text-sm text-gray-700">
                {t("Fluid input (ml)")}
                <input type="number" step="1" value={fluidInput} onChange={(e) => setFluidInput(e.target.value)} className={`mt-1 ${fieldCls}`} />
              </label>
              <label className="block text-sm text-gray-700">
                {t("Fluid output (ml)")}
                <input type="number" step="1" value={fluidOutput} onChange={(e) => setFluidOutput(e.target.value)} className={`mt-1 ${fieldCls}`} />
              </label>
              <label className="block text-sm text-gray-700">
                {t("CBD drainage")}
                <input type="text" value={cbdDrainage} onChange={(e) => setCbdDrainage(e.target.value)} className={`mt-1 ${fieldCls}`} />
              </label>
            </div>
          </Section>
        )}

        <Section title={t("Active complaint")} collapsible>
          <CheckboxGroup options={lookups.activeComplaints} value={activeComplaintIds} onChange={setActiveComplaintIds} />
          {othersComplaintId !== undefined && activeComplaintIds.includes(Number(othersComplaintId)) && (
            <input
              type="text"
              value={activeComplaintOther}
              onChange={(e) => setActiveComplaintOther(e.target.value)}
              placeholder={t("Specify")}
              className={`mt-2 max-w-xs ${fieldCls}`}
            />
          )}
        </Section>

        <Section title={t("Activity & behaviour")} collapsible>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <CheckboxGroup label={t("Activity")} boldLabel options={lookups.activities} value={activityIds} onChange={setActivityIds} />
              {othersActivityId !== undefined && activityIds.includes(Number(othersActivityId)) && (
                <input
                  type="text"
                  value={activityOther}
                  onChange={(e) => setActivityOther(e.target.value)}
                  placeholder={t("Specify")}
                  className={`mt-2 max-w-xs ${fieldCls}`}
                />
              )}
            </div>
            <div>
              <CheckboxGroup
                label={t("Psycho-social behaviour")}
                boldLabel
                options={lookups.psychoSocialBehaviours}
                value={psychoSocialIds}
                onChange={setPsychoSocialIds}
              />
              {othersPsychoSocialId !== undefined && psychoSocialIds.includes(Number(othersPsychoSocialId)) && (
                <input
                  type="text"
                  value={psychoSocialOther}
                  onChange={(e) => setPsychoSocialOther(e.target.value)}
                  placeholder={t("Specify")}
                  className={`mt-2 max-w-xs ${fieldCls}`}
                />
              )}
            </div>
            <label className="block text-sm text-gray-700">
              <span className="font-bold">{t("Disturbance level")}</span>
              <select value={disturbanceLevelId} onChange={(e) => setDisturbanceLevelId(e.target.value)} className={`mt-2 max-w-xs ${selectCls}`}>
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

        <Section title={t("Notes")} collapsible>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm text-gray-700">
              {t("Intervention")}
              <textarea value={intervention} onChange={(e) => setIntervention(e.target.value)} rows={3} className={`mt-1 ${fieldCls}`} />
            </label>
            <label className="block text-sm text-gray-700">
              {t("Doctor's plan")}
              <textarea value={doctorsPlan} onChange={(e) => setDoctorsPlan(e.target.value)} rows={3} className={`mt-1 ${fieldCls}`} />
            </label>
          </div>
        </Section>

        <Section title={t("Attribution")}>
          <label className="block max-w-md text-sm text-gray-700">
            {t("Entered by")} <span className="text-red-500">*</span>
            <select
              value={enteredBy}
              onChange={(e) => setEnteredBy(e.target.value)}
              required
              disabled={!residentId}
              className={`mt-1 disabled:bg-gray-100 ${selectCls}`}
            >
              <option value="">{t("Select staff")}</option>
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
            {t("Clear")}
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isSaving ? t("Saving...") : t("Save")}
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
  exclusiveByGroup,
  clearAllOptionId,
}: {
  label?: string;
  boldLabel?: boolean;
  options: (LookupOption & { group?: string | null })[];
  value: number[];
  onChange: (ids: number[]) => void;
  // When set, options carry a `group` (e.g. bowel output's "Amount" vs.
  // "Texture"): picking a new option deselects any other option already
  // picked from that same group, while other groups are left alone --
  // radio-like within a group, free multi-select across groups.
  exclusiveByGroup?: boolean;
  // An option (e.g. bowel output's "None") that overrides every group: picking
  // it clears every other selection, and picking anything else clears it --
  // it can never coexist with a group selection (can't describe a texture
  // for output that didn't happen).
  clearAllOptionId?: number;
}) {
  function toggle(id: number) {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
      return;
    }
    if (clearAllOptionId !== undefined && id === clearAllOptionId) {
      onChange([id]);
      return;
    }
    let next = clearAllOptionId !== undefined ? value.filter((v) => v !== clearAllOptionId) : value;
    if (exclusiveByGroup) {
      const group = options.find((o) => Number(o.id) === id)?.group;
      if (group) {
        const groupIds = new Set(options.filter((o) => o.group === group).map((o) => Number(o.id)));
        next = next.filter((v) => !groupIds.has(v));
      }
    }
    onChange([...next, id]);
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
