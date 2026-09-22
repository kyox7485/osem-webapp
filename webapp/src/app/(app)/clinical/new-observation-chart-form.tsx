"use client";

import { useState, useEffect } from "react";
import { createObservationChart, getLatestVitalsForResident } from "./observation-chart-actions";
import { StaffPickerWithOther, OTHERS_SENTINEL } from "@/components/staff-picker-with-other";
import type { LookupOption } from "@/lib/types";
import { useTranslation } from "@/components/language-provider";
import { toDatetimeLocalValue } from "@/lib/format-date";
import { useFormDirtyTracking } from "@/lib/use-form-dirty-tracking";

const BEHAVIOR_OPTIONS = [
  "Calm",
  "Restless",
  "Agitated",
  "Sleepy",
  "Anxious",
  "Angry",
  "Crying",
  "Aggressive",
];

const SPO2_CONDITIONS = ["Room Air", "Nasal Cannula 1-2L", "Nasal Cannula 3-4L", "Face Mask", "Non-Rebreather Mask", "Venturi Mask"];
const AVPU_OPTIONS = ["Alert", "Voice", "Pain", "Unresponsive"];

type YesNoNull = boolean | null;

type Resident = { id: number; resident_name: string; branch_id: number };

type Props = {
  residents: Resident[];
  allStaff: (LookupOption & { branch_id: number })[];
  presetResidentId?: string;
  onSaved: () => void;
};

function YesNoToggle({
  value,
  onChange,
}: {
  value: YesNoNull;
  onChange: (v: YesNoNull) => void;
}) {
  const t = useTranslation();
  const base = "rounded-md px-4 py-2 text-sm font-medium border transition-colors";
  const active = "bg-indigo-600 border-indigo-600 text-white";
  const inactive = "bg-white border-gray-300 text-gray-700 hover:bg-gray-50";
  return (
    <div className="flex gap-2">
      <button type="button" className={`${base} ${value === true ? active : inactive}`} onClick={() => onChange(value === true ? null : true)}>
        {t("Yes")}
      </button>
      <button type="button" className={`${base} ${value === false ? active : inactive}`} onClick={() => onChange(value === false ? null : false)}>
        {t("No")}
      </button>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100";
const labelCls = "mb-1 block text-sm font-medium text-gray-700";
const sectionCls = "rounded-md border border-gray-200 bg-white p-4 shadow-sm space-y-4";

export function NewObservationChartForm({ residents, allStaff, presetResidentId, onSaved }: Props) {
  const t = useTranslation();
  const [residentId, setResidentId] = useState(presetResidentId || "");
  const [entryTimestamp, setEntryTimestamp] = useState(() => toDatetimeLocalValue(new Date().toISOString()));
  const [activeIssue, setActiveIssue] = useState("");

  // Nursing assessment
  const [sobCough, setSobCough] = useState<YesNoNull>(null);
  const [pain, setPain] = useState<YesNoNull>(null);
  const [painLocation, setPainLocation] = useState("");
  const [wound, setWound] = useState("");
  const [appetite, setAppetite] = useState("");
  const [vomiting, setVomiting] = useState<YesNoNull>(null);
  const [diarrhea, setDiarrhea] = useState<YesNoNull>(null);
  const [urine, setUrine] = useState("");
  const [behavior, setBehavior] = useState<string[]>([]);
  const [behaviorOther, setBehaviorOther] = useState("");

  // Vitals
  const [systolicBp, setSystolicBp] = useState("");
  const [diastolicBp, setDiastolicBp] = useState("");
  const [heartRate, setHeartRate] = useState("");
  const [temperature, setTemperature] = useState("");
  const [spo2, setSpo2] = useState("");
  const [spo2Condition, setSpo2Condition] = useState("");
  const [dxt, setDxt] = useState("");
  const [avpu, setAvpu] = useState("");

  // Attribution
  const [createdBy, setCreatedBy] = useState("");
  const [createdByOtherName, setCreatedByOtherName] = useState("");

  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [vitalsLoading, setVitalsLoading] = useState(false);
  const { markDirty, markClean } = useFormDirtyTracking("observation-chart-new", submitForm);

  const selectedResident = residents.find((r) => String(r.id) === residentId);
  const staffOptions = allStaff.filter((s) => s.branch_id === selectedResident?.branch_id);

  // Pre-fill vitals when resident is selected
  useEffect(() => {
    if (!residentId) {
      setCreatedBy("");
      setCreatedByOtherName("");
      return;
    }
    setVitalsLoading(true);
    getLatestVitalsForResident(parseInt(residentId))
      .then((v) => {
        if (!v) return;
        setSystolicBp(v.systolic_bp != null ? String(v.systolic_bp) : "");
        setDiastolicBp(v.diastolic_bp != null ? String(v.diastolic_bp) : "");
        setHeartRate(v.heart_rate != null ? String(v.heart_rate) : "");
        setTemperature(v.temperature != null ? String(v.temperature) : "");
        setSpo2(v.spo2 != null ? String(v.spo2) : "");
        setSpo2Condition(v.spo2_condition ?? "");
        setDxt(v.dxt != null ? String(v.dxt) : "");
        setAvpu(v.avpu_label ?? "");
      })
      .finally(() => setVitalsLoading(false));
  }, [residentId]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleBehavior(option: string) {
    markDirty();
    setBehavior((prev) =>
      prev.includes(option) ? prev.filter((b) => b !== option) : [...prev, option]
    );
  }

  function resetForm() {
    if (!presetResidentId) setResidentId("");
    setEntryTimestamp(toDatetimeLocalValue(new Date().toISOString()));
    setActiveIssue("");
    setSobCough(null);
    setPain(null);
    setPainLocation("");
    setWound("");
    setAppetite("");
    setVomiting(null);
    setDiarrhea(null);
    setUrine("");
    setBehavior([]);
    setBehaviorOther("");
    setSystolicBp("");
    setDiastolicBp("");
    setHeartRate("");
    setTemperature("");
    setSpo2("");
    setSpo2Condition("");
    setDxt("");
    setAvpu("");
    setCreatedBy("");
    setCreatedByOtherName("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submitForm();
  }

  async function submitForm(): Promise<{ success: boolean; error?: string }> {
    setError("");

    if (!residentId) {
      setError(t("Please select a resident"));
      return { success: false, error: t("Please select a resident") };
    }
    if (!createdBy || (createdBy === OTHERS_SENTINEL && !createdByOtherName.trim())) {
      setError(t("Please select who entered this chart"));
      return { success: false, error: t("Please select who entered this chart") };
    }

    setIsSaving(true);

    const result = await createObservationChart({
      residentId: parseInt(residentId),
      residentName: selectedResident?.resident_name ?? "",
      entryTimestamp: new Date(entryTimestamp).toISOString(),
      activeIssue: activeIssue || null,
      sobCough,
      pain,
      painLocation: pain ? painLocation : null,
      wound: wound || null,
      appetite: appetite || null,
      vomiting,
      diarrhea,
      urine: urine || null,
      behavior,
      behaviorOther: behavior.includes("Others") ? behaviorOther : null,
      systolicBp: systolicBp ? parseInt(systolicBp) : null,
      diastolicBp: diastolicBp ? parseInt(diastolicBp) : null,
      heartRate: heartRate ? parseInt(heartRate) : null,
      temperature: temperature ? parseFloat(temperature) : null,
      spo2: spo2 ? parseInt(spo2) : null,
      spo2Condition: spo2Condition || null,
      dxt: dxt ? parseFloat(dxt) : null,
      avpu: avpu || null,
      createdBy: createdBy === OTHERS_SENTINEL ? "" : createdBy,
      createdByName: createdBy === OTHERS_SENTINEL ? null : (staffOptions.find((s) => s.id === createdBy)?.label ?? null),
      createdByOther: createdBy === OTHERS_SENTINEL ? createdByOtherName.trim() : null,
    });

    setIsSaving(false);

    if (!result.success) {
      setError(result.error || t("Failed to save"));
      return { success: false, error: result.error || t("Failed to save") };
    }

    resetForm();
    markClean();
    onSaved();
    return { success: true };
  }

  return (
    <div className="space-y-4" onChangeCapture={markDirty}>
      {/* Resident + Timestamp */}
      <div className={sectionCls}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>
              {t("Resident")} <span className="text-red-500">*</span>
            </label>
            <select
              value={residentId}
              onChange={(e) => setResidentId(e.target.value)}
              className={inputCls}
            >
              <option value="">{t("Select resident")}</option>
              {residents.map((r) => (
                <option key={r.id} value={r.id}>{r.resident_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>{t("Date & Time")}</label>
            <input
              type="datetime-local"
              value={entryTimestamp}
              onChange={(e) => setEntryTimestamp(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>{t("Active Issue")} <span className="text-xs font-normal text-gray-500">({t("why is this resident being monitored?")})</span></label>
          <textarea
            value={activeIssue}
            onChange={(e) => setActiveIssue(e.target.value)}
            rows={2}
            placeholder={t("e.g. Post-fall monitoring, fever workup, newly admitted, critical condition")}
            className={inputCls}
          />
        </div>
      </div>

      {/* Nursing Assessment */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        <div className={sectionCls}>
          <h3 className="text-sm font-bold text-gray-900">{t("Nursing Assessment")}</h3>

          {/* SOB / Cough */}
          <div>
            <label className={labelCls}>🫁 {t("SOB / Cough")}</label>
            <YesNoToggle value={sobCough} onChange={(v) => { setSobCough(v); markDirty(); }} />
          </div>

          {/* Pain */}
          <div className="space-y-2">
            <label className={labelCls}>⚡ {t("Pain")}</label>
            <YesNoToggle value={pain} onChange={(v) => { setPain(v); markDirty(); }} />
            {pain === true && (
              <input
                type="text"
                value={painLocation}
                onChange={(e) => setPainLocation(e.target.value)}
                placeholder={t("Location (e.g. Right knee, lower back)")}
                className={inputCls}
              />
            )}
          </div>

          {/* Wound */}
          <div>
            <label className={labelCls}>🤕 {t("Wound")}</label>
            <input
              type="text"
              value={wound}
              onChange={(e) => setWound(e.target.value)}
              placeholder={t("e.g. Dry / Soaked / Foul smell / N/A")}
              className={inputCls}
            />
          </div>

          {/* Appetite */}
          <div>
            <label className={labelCls}>🥣 {t("Appetite")}</label>
            <input
              type="text"
              value={appetite}
              onChange={(e) => setAppetite(e.target.value)}
              placeholder={t("e.g. Breakfast finished + drank 250ml; Lunch refused")}
              className={inputCls}
            />
          </div>

          {/* Vomiting */}
          <div>
            <label className={labelCls}>🤮 {t("Vomiting")}</label>
            <YesNoToggle value={vomiting} onChange={(v) => { setVomiting(v); markDirty(); }} />
          </div>

          {/* Diarrhea */}
          <div>
            <label className={labelCls}>💩 {t("Diarrhea")}</label>
            <YesNoToggle value={diarrhea} onChange={(v) => { setDiarrhea(v); markDirty(); }} />
          </div>

          {/* Urine */}
          <div>
            <label className={labelCls}>💧 {t("Urine")}</label>
            <input
              type="text"
              value={urine}
              onChange={(e) => setUrine(e.target.value)}
              placeholder={t("e.g. Clear yellow, adequate output / Catheter patent / Concentrated")}
              className={inputCls}
            />
          </div>

          {/* Behavior */}
          <div>
            <label className={labelCls}>🧠 {t("Behavior")} <span className="text-xs font-normal text-gray-500">({t("select all that apply")})</span></label>
            <div className="flex flex-wrap gap-2">
              {BEHAVIOR_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggleBehavior(opt)}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    behavior.includes(opt)
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-gray-300 bg-white text-gray-700 hover:border-indigo-300"
                  }`}
                >
                  {t(opt)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => toggleBehavior("Others")}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  behavior.includes("Others")
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : "border-gray-300 bg-white text-gray-700 hover:border-indigo-300"
                }`}
              >
                {t("Others")}
              </button>
            </div>
            {behavior.includes("Others") && (
              <input
                type="text"
                value={behaviorOther}
                onChange={(e) => setBehaviorOther(e.target.value)}
                placeholder={t("Specify other behaviour...")}
                className={`mt-2 ${inputCls}`}
              />
            )}
          </div>
        </div>

        {/* Vital Signs */}
        <div className={sectionCls}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">{t("Vital Signs")}</h3>
            {vitalsLoading && <span className="text-xs text-gray-400">{t("Loading latest vitals...")}</span>}
            {!vitalsLoading && residentId && (
              <span className="text-xs text-gray-400">{t("Pre-filled from latest record — edit if different")}</span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <label className={labelCls}>{t("Systolic BP")} (mmHg)</label>
              <input type="number" value={systolicBp} onChange={(e) => setSystolicBp(e.target.value)} min={0} max={300} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t("Diastolic BP")} (mmHg)</label>
              <input type="number" value={diastolicBp} onChange={(e) => setDiastolicBp(e.target.value)} min={0} max={200} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t("Heart Rate")} (bpm)</label>
              <input type="number" value={heartRate} onChange={(e) => setHeartRate(e.target.value)} min={0} max={300} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t("Temperature")} (°C)</label>
              <input type="number" step="0.1" value={temperature} onChange={(e) => setTemperature(e.target.value)} min={30} max={45} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t("SpO₂")} (%)</label>
              <input type="number" value={spo2} onChange={(e) => setSpo2(e.target.value)} min={0} max={100} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t("SpO₂ Condition")}</label>
              <select value={spo2Condition} onChange={(e) => setSpo2Condition(e.target.value)} className={inputCls}>
                <option value="">{t("Select or leave blank")}</option>
                {SPO2_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>{t("DXT")} (mmol/L)</label>
              <input type="number" step="0.1" value={dxt} onChange={(e) => setDxt(e.target.value)} min={0} max={50} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t("AVPU")}</label>
              <select value={avpu} onChange={(e) => setAvpu(e.target.value)} className={inputCls}>
                <option value="">{t("Select")}</option>
                {AVPU_OPTIONS.map((a) => <option key={a} value={a}>{t(a)}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Attribution */}
        <div className={sectionCls}>
          <div>
            <label className={labelCls}>
              {t("Entered By")} <span className="text-red-500">*</span>
            </label>
            <div className="max-w-md">
              <StaffPickerWithOther
                value={createdBy}
                otherName={createdByOtherName}
                onValueChange={setCreatedBy}
                onOtherNameChange={setCreatedByOtherName}
                staffOptions={staffOptions}
                disabled={!residentId}
                required
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
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
            {isSaving ? t("Saving...") : t("Save & Notify")}
          </button>
        </div>
      </form>
    </div>
  );
}
