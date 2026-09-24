"use client";

import { useState, useTransition } from "react";
import { createBehaviourChart } from "./behaviour-chart-actions";
import type { EpisodeInput } from "./behaviour-chart-actions";
import { StaffPickerWithOther, OTHERS_SENTINEL } from "@/components/staff-picker-with-other";
import type { LookupOption } from "@/lib/types";
import { useTranslation } from "@/components/language-provider";
import { toDatetimeLocalValue } from "@/lib/format-date";
import { Plus, Trash2, Clock } from "lucide-react";
import { useFormDirtyTracking } from "@/lib/use-form-dirty-tracking";

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

type Occurrence = { uid: string; startTime: string; endTime: string; note: string };
type BehaviourTimes = Record<string, Occurrence[]>;

type Resident = { id: number; resident_name: string; branch_id: number };

type Props = {
  residents: Resident[];
  allStaff: (LookupOption & { branch_id: number })[];
  presetResidentId?: string;
  onSaved: () => void;
};

const inputCls =
  "w-full rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100";
const labelCls = "mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300";
const sectionCls = "rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm space-y-3";

let uidCounter = 0;
function newUid() { return `occ-${++uidCounter}`; }
function newOccurrence(): Occurrence { return { uid: newUid(), startTime: "", endTime: "", note: "" }; }

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
              : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:border-indigo-300"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function OccurrenceRow({
  occ,
  onChange,
  onRemove,
  t,
}: {
  occ: Occurrence;
  onChange: (field: keyof Occurrence, value: string) => void;
  onRemove: () => void;
  t: (s: string) => string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 px-3 py-2">
      <div className="flex items-end gap-2 flex-1 min-w-0 flex-wrap">
        <div>
          <label className="mb-0.5 block text-xs text-gray-500 dark:text-gray-400">{t("From")}</label>
          <input
            type="time"
            value={occ.startTime}
            onChange={(e) => onChange("startTime", e.target.value)}
            className="rounded border border-gray-300 dark:border-gray-700 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="mb-0.5 block text-xs text-gray-500 dark:text-gray-400">{t("To")}</label>
          <input
            type="time"
            value={occ.endTime}
            onChange={(e) => onChange("endTime", e.target.value)}
            className="rounded border border-gray-300 dark:border-gray-700 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div className="flex-1 min-w-[120px]">
          <label className="mb-0.5 block text-xs text-gray-500 dark:text-gray-400">{t("Note")} <span className="text-gray-400 dark:text-gray-500">({t("optional")})</span></label>
          <input
            type="text"
            value={occ.note}
            onChange={(e) => onChange("note", e.target.value)}
            placeholder={t("Any note for this period")}
            className="w-full rounded border border-gray-300 dark:border-gray-700 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="rounded p-1 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 transition-colors"
        aria-label="Remove this period"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function BehaviourTimingSection({
  selected,
  times,
  onAddOccurrence,
  onRemoveOccurrence,
  onChangeOccurrence,
  t,
}: {
  selected: string[];
  times: BehaviourTimes;
  onAddOccurrence: (behaviour: string) => void;
  onRemoveOccurrence: (behaviour: string, uid: string) => void;
  onChangeOccurrence: (behaviour: string, uid: string, field: keyof Occurrence, value: string) => void;
  t: (s: string) => string;
}) {
  if (selected.length === 0) return null;
  return (
    <div className="space-y-3 pt-1">
      {selected.map((behaviour) => {
        const occs = times[behaviour] ?? [];
        return (
          <div key={behaviour} className="rounded-md bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-800 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500 shrink-0" />
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{behaviour}</span>
            </div>
            {occs.length === 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 pl-5">{t("Time not specified")} — {t("add a period to record exact time")}</p>
            )}
            {occs.map((occ) => (
              <OccurrenceRow
                key={occ.uid}
                occ={occ}
                onChange={(field, value) => onChangeOccurrence(behaviour, occ.uid, field, value)}
                onRemove={() => onRemoveOccurrence(behaviour, occ.uid)}
                t={t}
              />
            ))}
            <button
              type="button"
              onClick={() => onAddOccurrence(behaviour)}
              className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 pl-5"
            >
              <Plus className="h-3.5 w-3.5" />
              {occs.length === 0 ? t("Add a period") : t("Add another period")}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function NewBehaviourChartForm({ residents, allStaff, presetResidentId, onSaved }: Props) {
  const t = useTranslation();
  const [isPending, startTransition] = useTransition();

  const [residentId, setResidentId] = useState(presetResidentId || "");
  const [entryTimestamp, setEntryTimestamp] = useState(() => toDatetimeLocalValue(new Date().toISOString()));

  const [verbalBehavior, setVerbalBehavior] = useState<string[]>([]);
  const [verbalTimes, setVerbalTimes] = useState<BehaviourTimes>({});
  const [complaints, setComplaints] = useState("");

  const [physicalBehavior, setPhysicalBehavior] = useState<string[]>([]);
  const [physicalTimes, setPhysicalTimes] = useState<BehaviourTimes>({});

  const [emotionMood, setEmotionMood] = useState<string[]>([]);
  const [moodTimes, setMoodTimes] = useState<BehaviourTimes>({});

  const [sleepFrom, setSleepFrom] = useState("");
  const [sleepTo, setSleepTo] = useState("");
  const [restraint, setRestraint] = useState<string[]>([]);
  const [disturbanceLevel, setDisturbanceLevel] = useState<string>("");

  const [createdBy, setCreatedBy] = useState("");
  const [createdByOtherName, setCreatedByOtherName] = useState("");

  const [error, setError] = useState("");
  const { markDirty, markClean } = useFormDirtyTracking("behaviour-chart-new", submitForm);

  const selectedResident = residents.find((r) => String(r.id) === residentId);
  const staffOptions = allStaff.filter((s) => s.branch_id === selectedResident?.branch_id);

  function toggleBehaviour(
    opt: string,
    selected: string[],
    setSelected: React.Dispatch<React.SetStateAction<string[]>>,
    setTimes: React.Dispatch<React.SetStateAction<BehaviourTimes>>
  ) {
    markDirty();
    if (selected.includes(opt)) {
      setSelected((prev) => prev.filter((v) => v !== opt));
      setTimes((prev) => { const next = { ...prev }; delete next[opt]; return next; });
    } else {
      setSelected((prev) => [...prev, opt]);
      // No auto-add occurrence: time is optional
    }
  }

  function addOccurrence(
    behaviour: string,
    setTimes: React.Dispatch<React.SetStateAction<BehaviourTimes>>
  ) {
    markDirty();
    setTimes((prev) => ({
      ...prev,
      [behaviour]: [...(prev[behaviour] ?? []), newOccurrence()],
    }));
  }

  function removeOccurrence(
    behaviour: string,
    uid: string,
    setTimes: React.Dispatch<React.SetStateAction<BehaviourTimes>>
  ) {
    markDirty();
    setTimes((prev) => ({
      ...prev,
      [behaviour]: (prev[behaviour] ?? []).filter((o) => o.uid !== uid),
    }));
  }

  function changeOccurrence(
    behaviour: string,
    uid: string,
    field: keyof Occurrence,
    value: string,
    setTimes: React.Dispatch<React.SetStateAction<BehaviourTimes>>
  ) {
    setTimes((prev) => ({
      ...prev,
      [behaviour]: (prev[behaviour] ?? []).map((o) =>
        o.uid === uid ? { ...o, [field]: value } : o
      ),
    }));
  }

  function toggle(set: React.Dispatch<React.SetStateAction<string[]>>, opt: string) {
    markDirty();
    set((prev) => (prev.includes(opt) ? prev.filter((v) => v !== opt) : [...prev, opt]));
  }

  function collectEpisodes(): EpisodeInput[] {
    const result: EpisodeInput[] = [];
    const collect = (
      behaviours: string[],
      times: BehaviourTimes,
      category: EpisodeInput["category"]
    ) => {
      for (const behaviour of behaviours) {
        const occs = times[behaviour] ?? [];
        for (const occ of occs) {
          result.push({
            category,
            behaviour,
            startTime: occ.startTime || null,
            endTime: occ.endTime || null,
            note: occ.note.trim() || null,
          });
        }
      }
    };
    collect(verbalBehavior, verbalTimes, "Verbal");
    collect(physicalBehavior, physicalTimes, "Physical");
    collect(emotionMood, moodTimes, "Mood");
    return result;
  }

  function resetForm() {
    if (!presetResidentId) setResidentId("");
    setEntryTimestamp(toDatetimeLocalValue(new Date().toISOString()));
    setVerbalBehavior([]); setVerbalTimes({});
    setComplaints("");
    setPhysicalBehavior([]); setPhysicalTimes({});
    setEmotionMood([]); setMoodTimes({});
    setSleepFrom(""); setSleepTo("");
    setRestraint([]);
    setDisturbanceLevel("");
    setCreatedBy(""); setCreatedByOtherName("");
    setError("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitForm();
  }

  function submitForm(): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      setError("");

      if (!residentId) {
        const msg = t("Please select a resident");
        setError(msg);
        resolve({ success: false, error: msg });
        return;
      }
      if (!createdBy || (createdBy === OTHERS_SENTINEL && !createdByOtherName.trim())) {
        const msg = t("Please select who entered this chart");
        setError(msg);
        resolve({ success: false, error: msg });
        return;
      }

      // Validate occurrences: if one of start/end is filled, both must be filled and end > start
      const allOccurrences: Array<{ label: string; occ: Occurrence }> = [];
      for (const b of verbalBehavior) for (const o of verbalTimes[b] ?? []) allOccurrences.push({ label: b, occ: o });
      for (const b of physicalBehavior) for (const o of physicalTimes[b] ?? []) allOccurrences.push({ label: b, occ: o });
      for (const b of emotionMood) for (const o of moodTimes[b] ?? []) allOccurrences.push({ label: b, occ: o });

      for (const { label, occ } of allOccurrences) {
        const hasStart = !!occ.startTime;
        const hasEnd = !!occ.endTime;
        if (hasStart && !hasEnd) {
          const msg = `${label}: ${t("Please enter end time")}`;
          setError(msg);
          resolve({ success: false, error: msg });
          return;
        }
        if (!hasStart && hasEnd) {
          const msg = `${label}: ${t("Please enter start time")}`;
          setError(msg);
          resolve({ success: false, error: msg });
          return;
        }
        if (hasStart && hasEnd && occ.endTime <= occ.startTime) {
          const msg = `${label}: ${t("End time must be after start time")}`;
          setError(msg);
          resolve({ success: false, error: msg });
          return;
        }
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
          episodes: collectEpisodes(),
        });

        if (!result.success) {
          setError(result.error || t("Failed to save"));
          resolve({ success: false, error: result.error || t("Failed to save") });
          return;
        }
        resetForm();
        markClean();
        onSaved();
        resolve({ success: true });
      });
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" onChangeCapture={markDirty}>
      {error && <div className="rounded-md bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-800">{error}</div>}

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
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">🗣️ {t("Verbal Behavior")}</h3>
        <div>
          <label className={labelCls}>{t("Select all that apply")}</label>
          <MultiChips
            options={VERBAL_OPTIONS}
            selected={verbalBehavior}
            onToggle={(opt) => toggleBehaviour(opt, verbalBehavior, setVerbalBehavior, setVerbalTimes)}
          />
        </div>
        <BehaviourTimingSection
          selected={verbalBehavior}
          times={verbalTimes}
          onAddOccurrence={(b) => addOccurrence(b, setVerbalTimes)}
          onRemoveOccurrence={(b, uid) => removeOccurrence(b, uid, setVerbalTimes)}
          onChangeOccurrence={(b, uid, f, v) => changeOccurrence(b, uid, f, v, setVerbalTimes)}
          t={t}
        />
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
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">✋ {t("Physical Behavior")}</h3>
        <div>
          <label className={labelCls}>{t("Select all that apply")}</label>
          <MultiChips
            options={PHYSICAL_OPTIONS}
            selected={physicalBehavior}
            onToggle={(opt) => toggleBehaviour(opt, physicalBehavior, setPhysicalBehavior, setPhysicalTimes)}
          />
        </div>
        <BehaviourTimingSection
          selected={physicalBehavior}
          times={physicalTimes}
          onAddOccurrence={(b) => addOccurrence(b, setPhysicalTimes)}
          onRemoveOccurrence={(b, uid) => removeOccurrence(b, uid, setPhysicalTimes)}
          onChangeOccurrence={(b, uid, f, v) => changeOccurrence(b, uid, f, v, setPhysicalTimes)}
          t={t}
        />
      </div>

      {/* Emotion / Mood */}
      <div className={sectionCls}>
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">😌 {t("Emotion / Mood")}</h3>
        <div>
          <label className={labelCls}>{t("Select all that apply")}</label>
          <MultiChips
            options={EMOTION_OPTIONS}
            selected={emotionMood}
            onToggle={(opt) => toggleBehaviour(opt, emotionMood, setEmotionMood, setMoodTimes)}
          />
        </div>
        <BehaviourTimingSection
          selected={emotionMood}
          times={moodTimes}
          onAddOccurrence={(b) => addOccurrence(b, setMoodTimes)}
          onRemoveOccurrence={(b, uid) => removeOccurrence(b, uid, setMoodTimes)}
          onChangeOccurrence={(b, uid, f, v) => changeOccurrence(b, uid, f, v, setMoodTimes)}
          t={t}
        />
      </div>

      {/* Rest & Restraint (observation-level, no timing) */}
      <div className={sectionCls}>
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">🛌 {t("Rest & Restraint")}</h3>
        <div>
          <label className={labelCls}>{t("Sleep / Nap")}</label>
          <div className="flex items-center gap-3">
            <input
              type="time"
              value={sleepFrom}
              onChange={(e) => setSleepFrom(e.target.value)}
              className="rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <span className="text-sm text-gray-500 dark:text-gray-400">{t("to")}</span>
            <input
              type="time"
              value={sleepTo}
              onChange={(e) => setSleepTo(e.target.value)}
              className="rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>
            {t("Restraint")} <span className="text-xs font-normal text-gray-500 dark:text-gray-400">({t("select all that apply")})</span>
          </label>
          <MultiChips
            options={RESTRAINT_OPTIONS}
            selected={restraint}
            onToggle={(opt) => toggle(setRestraint, opt)}
          />
        </div>
      </div>

      {/* Level of Disturbance (observation-level) */}
      <div className={sectionCls}>
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">🤯 {t("Level of Disturbance")}</h3>
        <select value={disturbanceLevel} onChange={(e) => setDisturbanceLevel(e.target.value)} className={inputCls}>
          <option value="">{t("Select level")}</option>
          {DISTURBANCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
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
          className="rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60 disabled:opacity-50"
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
