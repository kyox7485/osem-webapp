"use client";

import { useState, useTransition } from "react";
import { createBehaviourChart } from "./behaviour-chart-actions";
import type { EpisodeInput } from "./behaviour-chart-actions";
import { StaffPickerWithOther, OTHERS_SENTINEL } from "@/components/staff-picker-with-other";
import type { LookupOption } from "@/lib/types";
import { useTranslation } from "@/components/language-provider";
import { toDatetimeLocalValue } from "@/lib/format-date";
import { Plus, Trash2 } from "lucide-react";

const VERBAL_OPTIONS = ["Quiet", "Shouting", "Scolding Staff", "Incoherent Speech"];
const PHYSICAL_OPTIONS = ["Calm", "Restless", "Walking Around", "Hitting Staff"];
const RESTRAINT_OPTIONS = ["On Mitten Gloves", "On Restrainer Vest", "Not on any restrain"];
const EMOTION_OPTIONS = ["Relaxed", "Agitated", "Sleepy", "Anxious", "Angry", "Crying"];
const DISTURBANCE_OPTIONS = [
  { value: 0, label: "0 – No disturb" },
  { value: 1, label: "1 – Occasionally sound" },
  { value: 2, label: "2 – Frequent sound (others can sleep)" },
  { value: 3, label: "3 – Frequent sound (others can't sleep)" },
  { value: 4, label: "4 – Persistent sound (disturbing activity)" },
];

const CATEGORY_OPTIONS = ["Verbal", "Physical", "Mood", "Restraint"] as const;
const BEHAVIOUR_BY_CATEGORY: Record<string, string[]> = {
  Verbal: VERBAL_OPTIONS,
  Physical: PHYSICAL_OPTIONS,
  Mood: EMOTION_OPTIONS,
  Restraint: RESTRAINT_OPTIONS,
};

type Resident = { id: number; resident_name: string; branch_id: number };

type Props = {
  residents: Resident[];
  allStaff: (LookupOption & { branch_id: number })[];
  presetResidentId?: string;
  onSaved: () => void;
};

const inputCls =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100";
const labelCls = "mb-1 block text-sm font-medium text-gray-700";
const sectionCls = "rounded-md border border-gray-200 bg-white p-4 shadow-sm space-y-4";

function MultiChips({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (opt: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onToggle(opt)}
          className={`rounded-full border px-3 py-1 text-sm transition-colors ${
            selected.includes(opt)
              ? "border-indigo-600 bg-indigo-600 text-white"
              : "border-gray-300 bg-white text-gray-700 hover:border-indigo-300"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function emptyEpisode(): EpisodeInput {
  return { category: "Verbal", behaviour: "", startTime: "", endTime: "", note: null };
}

export function NewBehaviourChartForm({ residents, allStaff, presetResidentId, onSaved }: Props) {
  const t = useTranslation();
  const [isPending, startTransition] = useTransition();

  const [residentId, setResidentId] = useState(presetResidentId || "");
  const [entryTimestamp, setEntryTimestamp] = useState(() => toDatetimeLocalValue(new Date().toISOString()));

  const [verbalBehavior, setVerbalBehavior] = useState<string[]>([]);
  const [complaints, setComplaints] = useState("");
  const [physicalBehavior, setPhysicalBehavior] = useState<string[]>([]);
  const [sleepFrom, setSleepFrom] = useState("");
  const [sleepTo, setSleepTo] = useState("");
  const [restraint, setRestraint] = useState<string[]>([]);
  const [emotionMood, setEmotionMood] = useState<string[]>([]);
  const [disturbanceLevel, setDisturbanceLevel] = useState<string>("");

  const [episodes, setEpisodes] = useState<EpisodeInput[]>([]);

  const [createdBy, setCreatedBy] = useState("");
  const [createdByOtherName, setCreatedByOtherName] = useState("");

  const [error, setError] = useState("");

  const selectedResident = residents.find((r) => String(r.id) === residentId);
  const staffOptions = allStaff.filter((s) => s.branch_id === selectedResident?.branch_id);

  function toggle(set: React.Dispatch<React.SetStateAction<string[]>>, opt: string) {
    set((prev) => (prev.includes(opt) ? prev.filter((v) => v !== opt) : [...prev, opt]));
  }

  function addEpisode() {
    setEpisodes((prev) => [...prev, emptyEpisode()]);
  }

  function removeEpisode(idx: number) {
    setEpisodes((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateEpisode(idx: number, field: keyof EpisodeInput, value: string | null) {
    setEpisodes((prev) =>
      prev.map((ep, i) => {
        if (i !== idx) return ep;
        if (field === "category") {
          return { ...ep, category: value as EpisodeInput["category"], behaviour: "" };
        }
        return { ...ep, [field]: value };
      })
    );
  }

  function resetForm() {
    if (!presetResidentId) setResidentId("");
    setEntryTimestamp(toDatetimeLocalValue(new Date().toISOString()));
    setVerbalBehavior([]);
    setComplaints("");
    setPhysicalBehavior([]);
    setSleepFrom("");
    setSleepTo("");
    setRestraint([]);
    setEmotionMood([]);
    setDisturbanceLevel("");
    setEpisodes([]);
    setCreatedBy("");
    setCreatedByOtherName("");
    setError("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!residentId) { setError(t("Please select a resident")); return; }
    if (!createdBy || (createdBy === OTHERS_SENTINEL && !createdByOtherName.trim())) {
      setError(t("Please select who entered this chart"));
      return;
    }

    // Validate episodes
    for (let i = 0; i < episodes.length; i++) {
      const ep = episodes[i];
      if (!ep.behaviour) { setError(`Episode ${i + 1}: ${t("Please select a behaviour")}`); return; }
      if (!ep.startTime) { setError(`Episode ${i + 1}: ${t("Please enter start time")}`); return; }
      if (!ep.endTime) { setError(`Episode ${i + 1}: ${t("Please enter end time")}`); return; }
      if (ep.endTime <= ep.startTime) { setError(`Episode ${i + 1}: ${t("End time must be after start time")}`); return; }
    }

    startTransition(async () => {
      const result = await createBehaviourChart({
        residentId: parseInt(residentId),
        residentName: selectedResident?.resident_name ?? "",
        entryTimestamp: new Date(entryTimestamp).toISOString(),
        verbalBehavior,
        complaints: complaints.trim() || null,
        physicalBehavior,
        sleepFrom: sleepFrom || null,
        sleepTo: sleepTo || null,
        restraint,
        emotionMood,
        disturbanceLevel: disturbanceLevel !== "" ? parseInt(disturbanceLevel) : null,
        createdBy: createdBy === OTHERS_SENTINEL ? "" : createdBy,
        createdByName: createdBy === OTHERS_SENTINEL ? null : (staffOptions.find((s) => s.id === createdBy)?.label ?? null),
        createdByOther: createdBy === OTHERS_SENTINEL ? createdByOtherName.trim() : null,
        episodes,
      });

      if (!result.success) { setError(result.error || t("Failed to save")); return; }

      resetForm();
      onSaved();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {/* Patient + Timestamp */}
      <div className={sectionCls}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>
              {t("Resident")} <span className="text-red-500">*</span>
            </label>
            <select
              value={residentId}
              onChange={(e) => setResidentId(e.target.value)}
              disabled={!!presetResidentId}
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
      </div>

      {/* Verbal Behavior */}
      <div className={sectionCls}>
        <h3 className="text-sm font-bold text-gray-900">🗣️ {t("Verbal Behavior")}</h3>
        <div>
          <label className={labelCls}>{t("Select all that apply")}</label>
          <MultiChips options={VERBAL_OPTIONS} selected={verbalBehavior} onToggle={(opt) => toggle(setVerbalBehavior, opt)} />
        </div>
        <div>
          <label className={labelCls}>💬 {t("Active Complaints")}</label>
          <textarea
            value={complaints}
            onChange={(e) => setComplaints(e.target.value)}
            rows={2}
            placeholder={t("Describe any active complaints...")}
            className={inputCls}
          />
        </div>
      </div>

      {/* Physical Behavior */}
      <div className={sectionCls}>
        <h3 className="text-sm font-bold text-gray-900">✋ {t("Physical Behavior")}</h3>
        <MultiChips options={PHYSICAL_OPTIONS} selected={physicalBehavior} onToggle={(opt) => toggle(setPhysicalBehavior, opt)} />
      </div>

      {/* Rest & Restraint */}
      <div className={sectionCls}>
        <h3 className="text-sm font-bold text-gray-900">🛌 {t("Rest & Restraint")}</h3>
        <div>
          <label className={labelCls}>{t("Sleep / Nap")}</label>
          <div className="flex items-center gap-3">
            <input
              type="time"
              value={sleepFrom}
              onChange={(e) => setSleepFrom(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <span className="text-sm text-gray-500">{t("to")}</span>
            <input
              type="time"
              value={sleepTo}
              onChange={(e) => setSleepTo(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>{t("Restraint")} <span className="text-xs font-normal text-gray-500">({t("select all that apply")})</span></label>
          <MultiChips options={RESTRAINT_OPTIONS} selected={restraint} onToggle={(opt) => toggle(setRestraint, opt)} />
        </div>
      </div>

      {/* Emotion / Mood */}
      <div className={sectionCls}>
        <h3 className="text-sm font-bold text-gray-900">😌 {t("Emotion / Mood")}</h3>
        <MultiChips options={EMOTION_OPTIONS} selected={emotionMood} onToggle={(opt) => toggle(setEmotionMood, opt)} />
      </div>

      {/* Level of Disturbance */}
      <div className={sectionCls}>
        <h3 className="text-sm font-bold text-gray-900">🤯 {t("Level of Disturbance")}</h3>
        <select value={disturbanceLevel} onChange={(e) => setDisturbanceLevel(e.target.value)} className={inputCls}>
          <option value="">{t("Select level")}</option>
          {DISTURBANCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Timed Episodes */}
      <div className={sectionCls}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900">⏱️ {t("Timed Episodes")} <span className="text-xs font-normal text-gray-400">({t("optional")})</span></h3>
          <button
            type="button"
            onClick={addEpisode}
            className="inline-flex items-center gap-1.5 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("Add period")}
          </button>
        </div>

        {episodes.length === 0 && (
          <p className="text-sm text-gray-400">{t("Record specific time periods for each behaviour episode.")}</p>
        )}

        <div className="space-y-3">
          {episodes.map((ep, idx) => (
            <div key={idx} className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("Episode")} {idx + 1}</span>
                <button
                  type="button"
                  onClick={() => removeEpisode(idx)}
                  className="rounded p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  aria-label="Remove episode"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">{t("Category")}</label>
                  <select
                    value={ep.category}
                    onChange={(e) => updateEpisode(idx, "category", e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>{t(c)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">{t("Behaviour")}</label>
                  <select
                    value={ep.behaviour}
                    onChange={(e) => updateEpisode(idx, "behaviour", e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">{t("Select")}</option>
                    {BEHAVIOUR_BY_CATEGORY[ep.category]?.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">{t("From")}</label>
                  <input
                    type="time"
                    value={ep.startTime}
                    onChange={(e) => updateEpisode(idx, "startTime", e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">{t("To")}</label>
                  <input
                    type="time"
                    value={ep.endTime}
                    onChange={(e) => updateEpisode(idx, "endTime", e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">{t("Note")} <span className="text-gray-400">({t("optional")})</span></label>
                <input
                  type="text"
                  value={ep.note ?? ""}
                  onChange={(e) => updateEpisode(idx, "note", e.target.value || null)}
                  placeholder={t("Any note for this episode")}
                  className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          ))}
        </div>

        {episodes.length > 0 && (
          <button
            type="button"
            onClick={addEpisode}
            className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800"
          >
            <Plus className="h-4 w-4" />
            {t("Add another period")}
          </button>
        )}
      </div>

      {/* Entered By */}
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
          disabled={isPending}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {t("Clear")}
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {isPending && (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
          {isPending ? t("Saving...") : t("Save & Notify")}
        </button>
      </div>
    </form>
  );
}
