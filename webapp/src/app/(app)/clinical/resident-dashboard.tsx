"use client";

import { useMemo, useState, useTransition } from "react";
import { formatDate } from "@/lib/format-date";
import { useTranslation } from "@/components/language-provider";
import {
  type Vital,
  getDailyAverages,
  getDXTReadings,
  resolveDateRange,
  filterVitalsByRange,
  formatVitalDateTime,
} from "@/lib/vitals";
import {
  InteractiveVitalChart,
  VITAL_UNITS,
  formatVitalValue,
  resolveActivePointId,
  type ChartPoint,
  type VitalKind,
  type VitalPointSelection,
} from "./interactive-vital-chart";
import { VitalsHistoryModal } from "./vitals-history-modal";
import { useRouter } from "next/navigation";
import {
  AllergyQuestion,
  compileAllergy,
  parseAllergyText,
  EMPTY_ALLERGY,
  type AllergyAnswers,
} from "@/lib/allergy-text";
import { groupDiagnosisOptions, type DiagnosisGrouping } from "@/lib/diagnosis-groups";
import { updateResidentParticulars } from "./resident-particulars-actions";
import type { DiagnosisOption } from "@/lib/types";

type EditingField = "medicalHistory" | "allergy" | "tcaNotes";

type HistoryDraft = {
  ids: number[];
  othersRemark: string;
  freeText: string;
};

const inputCls =
  "mt-1 w-full rounded-lg border border-line-strong bg-input px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-colors";

type PlanEntry = { entry_timestamp: string; value: string } | null;

type Props = {
  allergy: string | null;
  pastMedicalCondition: string | null;
  currentMedicationList: string | null;
  tcaNotes: string | null;
  // Structured particulars behind the read-only display strings above. Only
  // supplied where editing is offered (the New Entry tab); when absent the
  // three cards render read-only exactly as before.
  pastMedicalConditionText?: string | null;
  diagnosisOptions?: DiagnosisOption[];
  selectedDiagnosisIds?: number[];
  diagnosisOthersRemark?: string | null;
  residentId?: number;
  vitals: Vital[];
  plans: {
    medical: PlanEntry;
    nursing: PlanEntry;
    diet: PlanEntry;
    dressing: PlanEntry;
    monitoring: PlanEntry;
    physio: PlanEntry;
  };
  // Collapsed-by-default, click-to-expand cards -- used while creating a
  // new entry, to keep reference info out of the way without hiding it
  // entirely. When reviewing past notes the same info is shown open.
  collapsible?: boolean;
  // Called after a successful inline save so the host form can drop its own
  // dirty state (the dashboard's values may now differ from what it rendered).
  onParticularsChanged?: () => void;
};

const DXT_CARD_LIMIT = 10;

function dailyPoints(
  daily: ReturnType<typeof getDailyAverages>,
  pick: (d: ReturnType<typeof getDailyAverages>[number]) => number | null,
  secondary?: (d: ReturnType<typeof getDailyAverages>[number]) => number | null,
  remark?: (d: ReturnType<typeof getDailyAverages>[number]) => string | null
): ChartPoint[] {
  return daily
    .map((d) => ({
      id: d.dateKey,
      // Calendar date only -- a daily average didn't happen at a time.
      label: formatDate(`${d.dateKey}T00:00:00+08:00`),
      primary: pick(d),
      secondary: secondary?.(d) ?? null,
      isDailyAverage: true,
      remark: remark?.(d) ?? null,
    }))
    .filter((p) => p.primary !== null);
}

export function ResidentDashboard({
  allergy,
  pastMedicalCondition,
  currentMedicationList,
  tcaNotes,
  pastMedicalConditionText,
  diagnosisOptions,
  selectedDiagnosisIds,
  diagnosisOthersRemark,
  residentId,
  vitals,
  plans,
  collapsible = false,
  onParticularsChanged,
}: Props) {
  const t = useTranslation();
  const [historyOpen, setHistoryOpen] = useState(false);

  // Editing is offered only where a residentId was passed in -- the other two
  // call sites (per-resident progress-notes page, review tab) keep the cards
  // read-only with no behavioural change.
  const editable = residentId !== undefined;
  const {
    editing, startEdit, cancelEdit, save, isPending, error,
    tcaDraft, setTcaDraft,
    allergyDraft, setAllergyDraft,
    historyDraft, setHistoryDraft,
  } = useParticularsEditing(
    residentId ?? 0,
    {
      allergy,
      tcaNotes,
      pastMedicalConditionText: pastMedicalConditionText ?? null,
      selectedDiagnosisIds: selectedDiagnosisIds ?? [],
      diagnosisOthersRemark: diagnosisOthersRemark ?? null,
    },
    onParticularsChanged
  );

  // Main-page default: the latest 7 calendar days of readings, collapsed to
  // one daily average per day. DXT is the exception -- see below.
  const daily = useMemo(() => {
    const range = resolveDateRange(vitals, 7, "", "");
    return getDailyAverages(filterVitalsByRange(vitals, range));
  }, [vitals]);

  // DXT is never averaged (some residents are only tested twice a week, so
  // a daily average would invent readings) -- the card shows the latest 10
  // actual readings with their real timestamps.
  const dxt = useMemo(() => getDXTReadings(vitals, DXT_CARD_LIMIT), [vitals]);

  const cards = useMemo(() => {
    const bp = dailyPoints(daily, (d) => d.systolic_bp, (d) => d.diastolic_bp);
    const hr = dailyPoints(daily, (d) => d.heart_rate);
    const temp = dailyPoints(daily, (d) => d.temperature);
    const spo2 = dailyPoints(daily, (d) => d.spo2, undefined, (d) => d.spo2_condition);
    const dxtPoints: ChartPoint[] = dxt.map((r) => ({
      id: r.id,
      // DXT is an actual reading, so the real time of day belongs here.
      label: formatVitalDateTime(r.timestamp),
      primary: r.value,
      isDailyAverage: false,
      remark: r.remark,
    }));
    return { BP: bp, HR: hr, Temp: temp, SpO2: spo2, DXT: dxtPoints };
  }, [daily, dxt]);

  return (
    <div className="mb-6 space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <DashCard
          title={t("Medical / surgical history")}
          collapsible={collapsible}
          action={
            editable ? (
              <EditButton
                editing={editing === "medicalHistory"}
                onClick={() => startEdit("medicalHistory")}
              />
            ) : null
          }
        >
          {editing === "medicalHistory" ? (
            <MedicalHistoryEditor
              diagnosisOptions={diagnosisOptions ?? []}
              selected={historyDraft.ids}
              othersRemark={historyDraft.othersRemark}
              freeText={historyDraft.freeText}
              onToggle={(id) => setHistoryDraft((d) => ({
                ...d,
                ids: d.ids.includes(id) ? d.ids.filter((x) => x !== id) : [...d.ids, id],
              }))}
              onOthersRemark={(v) => setHistoryDraft((d) => ({ ...d, othersRemark: v }))}
              onFreeText={(v) => setHistoryDraft((d) => ({ ...d, freeText: v }))}
            />
          ) : (
            <ClampedText value={pastMedicalCondition} />
          )}
        </DashCard>
        <DashCard title={t("Current medication list")} collapsible={collapsible}>
          <ClampedText value={currentMedicationList} />
        </DashCard>
        <DashCard
          title={t("Known allergy")}
          collapsible={collapsible}
          action={
            editable ? (
              <EditButton
                editing={editing === "allergy"}
                onClick={() => startEdit("allergy")}
              />
            ) : null
          }
        >
          {editing === "allergy" ? (
            <AllergyEditor
              answers={allergyDraft.answers}
              legacyText={allergyDraft.legacyText}
              onAnswers={(a) => setAllergyDraft({ answers: a, legacyText: null })}
              onLegacy={(v) => setAllergyDraft({ answers: EMPTY_ALLERGY, legacyText: v })}
            />
          ) : (
            <ClampedText value={allergy} />
          )}
        </DashCard>
      </div>

      <DashCard
        title={t("TCA notes")}
        collapsible={collapsible}
        action={
          editable ? (
            <EditButton editing={editing === "tcaNotes"} onClick={() => startEdit("tcaNotes")} />
          ) : null
        }
      >
        {editing === "tcaNotes" ? (
          <div data-standalone-editor>
            <textarea
              value={tcaDraft}
              onChange={(e) => setTcaDraft(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-line-strong bg-input px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-colors"
            />
          </div>
        ) : (
          <ClampedText value={tcaNotes} />
        )}
      </DashCard>

      {editing && (
        <EditorFooter
          onCancel={cancelEdit}
          onSave={save}
          isPending={isPending}
          error={error}
        />
      )}

      <DashCard
        title={t("Recent vitals")}
        action={
          vitals.length > 0 ? (
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="-mr-1 flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
            >
              {t("View history")}
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : null
        }
      >
        {vitals.length === 0 ? (
          <EmptyNote text={t("No vitals recorded yet.")} />
        ) : (
          // 5 cards, no range controls on the page -- the detailed history
          // lives behind "View history" so this stays scannable on mobile.
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <VitalCard kind="BP" points={cards.BP} />
            <VitalCard kind="HR" points={cards.HR} />
            <VitalCard kind="Temp" points={cards.Temp} />
            <VitalCard kind="SpO2" points={cards.SpO2} />
            <VitalCard kind="DXT" points={cards.DXT} />
          </div>
        )}
      </DashCard>

      {historyOpen && <VitalsHistoryModal vitals={vitals} onClose={() => setHistoryOpen(false)} />}

      <DashCard title={t("Last ordered plans")} collapsible={collapsible}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <PlanRow label={t("Medical / treatment plan")} entry={plans.medical} />
          <PlanRow label={t("Nursing plan")} entry={plans.nursing} />
          <PlanRow label={t("Diet plan")} entry={plans.diet} />
          <PlanRow label={t("Dressing plan")} entry={plans.dressing} />
          <PlanRow label={t("Monitoring plan")} entry={plans.monitoring} />
          <PlanRow label={t("Physio plan")} entry={plans.physio} />
        </div>
      </DashCard>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      className="animate-spin"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M8 1.5A6.5 6.5 0 0 1 14.5 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function EditButton({ editing, onClick }: { editing: boolean; onClick: () => void }) {
  const t = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={editing}
      className="-mr-1 flex min-h-9 cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
    >
      {t("Edit these details")}
    </button>
  );
}

/**
 * One Save/Cancel pair for whichever card is open. The three particulars have
 * genuinely different shapes, so each card has its own editor, but they all
 * share this footer and the parent's `useTransition` (CLAUDE.md: a plain
 * `submitting` state flag never paints before navigation).
 */
function EditorFooter({
  onCancel,
  onSave,
  isPending,
  error,
}: {
  onCancel: () => void;
  onSave: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const t = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error && <p className="mr-auto text-xs text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="button"
        onClick={onCancel}
        disabled={isPending}
        className="min-h-9 cursor-pointer rounded-lg border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-fg-secondary transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {t("Cancel")}
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={isPending}
        className="flex min-h-9 items-center gap-1.5 cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-indigo-600 dark:hover:bg-indigo-500"
      >
        {isPending ? (
          <>
            <Spinner />
            {t("Saving...")}
          </>
        ) : (
          t("Save")
        )}
      </button>
    </div>
  );
}

/**
 * The allergy column is a compiled string, not free text -- see
 * lib/allergy-text.tsx. When it parses, show the questionnaire; when it
 * doesn't (legacy/imported Access values), fall back to a plain textarea
 * seeded with the raw string, exactly as resident-form.tsx does, so old rows
 * stay editable instead of silently resetting to an empty questionnaire.
 */
function AllergyEditor({
  answers,
  legacyText,
  onAnswers,
  onLegacy,
}: {
  answers: AllergyAnswers;
  legacyText: string | null;
  onAnswers: (a: AllergyAnswers) => void;
  onLegacy: (v: string) => void;
}) {
  const t = useTranslation();
  return (
    <div className="space-y-3" data-standalone-editor>
      {legacyText !== null ? (
        <textarea
          value={legacyText}
          onChange={(e) => onLegacy(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-line-strong bg-input px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-colors"
        />
      ) : (
        <>
          <AllergyQuestion
            label={t("Any known food allergy?")}
            yn={answers.foodYN}
            reaction={answers.foodReaction}
            reactionPlaceholder={t("Reaction")}
            onYN={(v) => onAnswers({ ...answers, foodYN: v })}
            onReaction={(v) => onAnswers({ ...answers, foodReaction: v })}
            t={t}
          />
          <AllergyQuestion
            label={t("Any known medicine allergy?")}
            yn={answers.medYN}
            reaction={answers.medReaction}
            reactionPlaceholder={t("Reaction")}
            onYN={(v) => onAnswers({ ...answers, medYN: v })}
            onReaction={(v) => onAnswers({ ...answers, medReaction: v })}
            t={t}
          />
        </>
      )}
    </div>
  );
}

function MedicalHistoryEditor({
  diagnosisOptions,
  selected,
  othersRemark,
  freeText,
  onToggle,
  onOthersRemark,
  onFreeText,
}: {
  diagnosisOptions: DiagnosisOption[];
  selected: number[];
  othersRemark: string;
  freeText: string;
  onToggle: (id: number) => void;
  onOthersRemark: (v: string) => void;
  onFreeText: (v: string) => void;
}) {
  const t = useTranslation();
  const [infectiousExpanded, setInfectiousExpanded] = useState(false);
  const { main, infectious, others }: DiagnosisGrouping = groupDiagnosisOptions(diagnosisOptions);

  const renderOption = (opt: DiagnosisOption) => {
    const checked = selected.includes(opt.id);
    return (
      <label
        key={opt.id}
        className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
          checked
            ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-300"
            : "border-line bg-surface text-fg-secondary hover:border-line-strong hover:bg-hover"
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(opt.id)}
          className="mt-0.5 shrink-0 rounded border-line-strong text-indigo-600 focus:ring-indigo-500 dark:text-indigo-400"
        />
        <span className="text-sm leading-tight">
          {opt.name_en}
          {opt.name_ms && opt.name_ms !== opt.name_en && (
            <span className="block text-xs text-fg-faint">{opt.name_ms}</span>
          )}
        </span>
      </label>
    );
  };

  return (
    <div className="space-y-3" data-standalone-editor>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{main.map(renderOption)}</div>

      {others && selected.includes(others.id) && (
        <input
          type="text"
          value={othersRemark}
          onChange={(e) => onOthersRemark(e.target.value)}
          placeholder={t("Please specify...")}
          className={inputCls}
        />
      )}

      {infectious.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setInfectiousExpanded((v) => !v)}
            className="flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-fg-secondary transition-colors hover:text-fg"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              className={`transition-transform ${infectiousExpanded ? "rotate-90" : ""}`}
            >
              <path
                d="M6 12L10 8 6 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {t("Infectious Disease")}
          </button>
          {infectiousExpanded && (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {infectious.map(renderOption)}
            </div>
          )}
        </div>
      )}

      <div>
        <label className="text-sm font-medium text-fg-secondary" htmlFor="medical-history-free-text">
          {t("Additional history notes")}
        </label>
        <textarea
          id="medical-history-free-text"
          value={freeText}
          onChange={(e) => onFreeText(e.target.value)}
          rows={3}
          className={inputCls}
        />
      </div>
    </div>
  );
}

/**
 * Owns the open-editor state for the three inline particulars editors: which
 * card is open, the draft for that card, and the shared save. One editor at a
 * time -- opening a second closes the first, so there is never more than one
 * unsaved draft and one Save/Cancel pair on screen.
 *
 * Saving calls the Server Action then `router.refresh()`, which re-runs the
 * server component and re-reads the three columns -- so the cards show what
 * was actually persisted, not what the client believed it sent.
 */
function useParticularsEditing(
  residentId: number,
  source: {
    allergy: string | null;
    tcaNotes: string | null;
    pastMedicalConditionText: string | null;
    selectedDiagnosisIds: number[];
    diagnosisOthersRemark: string | null;
  },
  onChanged: (() => void) | undefined
) {
  const t = useTranslation();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingField | null>(null);

  const [tcaDraft, setTcaDraft] = useState("");
  const [allergyDraft, setAllergyDraft] = useState<{
    answers: AllergyAnswers;
    legacyText: string | null;
  }>({ answers: EMPTY_ALLERGY, legacyText: null });
  const [historyDraft, setHistoryDraft] = useState<HistoryDraft>({
    ids: [], othersRemark: "", freeText: "",
  });

  function startEdit(field: EditingField) {
    setError(null);
    // Seed the drafts from the raw stored values, not the display strings:
    // pastMedicalCondition in particular is formatMedicalHistory()'s joined
    // output, and round-tripping it would bake coded labels back into the
    // free-text column.
    if (field === "tcaNotes") setTcaDraft(source.tcaNotes ?? "");
    if (field === "allergy") {
      setAllergyDraft(
        source.allergy
          ? (() => {
              const parsed = parseAllergyText(source.allergy);
              return parsed
                ? { answers: parsed, legacyText: null }
                : { answers: EMPTY_ALLERGY, legacyText: source.allergy };
            })()
          : { answers: EMPTY_ALLERGY, legacyText: null }
      );
    }
    if (field === "medicalHistory") {
      setHistoryDraft({
        ids: source.selectedDiagnosisIds,
        othersRemark: source.diagnosisOthersRemark ?? "",
        freeText: source.pastMedicalConditionText ?? "",
      });
    }
    setEditing(field);
  }

  function cancelEdit() {
    if (isPending) return;
    setEditing(null);
    setError(null);
  }

  function save() {
    if (!editing || isPending) return;
    setError(null);
    const field = editing;

    const input =
      field === "allergy"
        ? {
            residentId,
            field: "allergy" as const,
            // The questionnaire compiles to a fixed English format; a legacy
            // free-text value round-trips verbatim through the textarea.
            allergy:
              allergyDraft.legacyText !== null
                ? allergyDraft.legacyText
                : compileAllergy(allergyDraft.answers),
          }
        : field === "tcaNotes"
          ? { residentId, field: "tcaNotes" as const, tcaNotes: tcaDraft }
          : {
              residentId,
              field: "medicalHistory" as const,
              diagnosisOptionIds: historyDraft.ids,
              othersRemark: historyDraft.othersRemark,
              pastMedicalCondition: historyDraft.freeText,
            };

    startTransition(async () => {
      const result = await updateResidentParticulars(input);
      if (!result.success) {
        setError(result.error ?? t("Failed to save. Please try again."));
        return;
      }
      setEditing(null);
      router.refresh();
      onChanged?.();
    });
  }

  return {
    editing,
    startEdit,
    cancelEdit,
    save,
    isPending,
    error,
    tcaDraft,
    setTcaDraft,
    allergyDraft,
    setAllergyDraft,
    historyDraft,
    setHistoryDraft,
  };
}

/**
 * One vital card. The value is the loudest thing on it, the sparkline
 * supports it, and the date/remark is quiet -- in that order.
 *
 * Point selection is lifted up to the card so the big number and the chart
 * highlight always agree. The latest reading is the default; hovering a
 * point previews it, and tapping one keeps it until "Latest" is tapped.
 */
function VitalCard({ kind, points }: { kind: VitalKind; points: ChartPoint[] }) {
  const t = useTranslation();
  const [selection, setSelection] = useState<VitalPointSelection>({ hoveredId: null, selectedId: null });
  const active = points.find((p) => p.id === resolveActivePointId(points, selection)) ?? null;
  // True only when the user has committed to something other than the newest
  // point -- that's when the escape hatch to "Latest" is worth showing.
  const pinned = selection.selectedId !== null && selection.selectedId !== points[points.length - 1]?.id;

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-3 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide text-fg-secondary">{t(kind)}</span>
        <span className="text-[10px] text-fg-faint">
          {kind === "DXT" ? t("Latest 10") : t("7-day daily avg")}
        </span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold leading-none tabular-nums text-fg">
          {active ? formatVitalValue(kind, active) : "--"}
        </span>
        {active && <span className="text-xs text-fg-muted">{VITAL_UNITS[kind]}</span>}
        {/* Reserved whether or not it is shown, so previewing a point can't
            reflow the value or push the sparkline down the card. */}
        {pinned && (
          <button
            type="button"
            onClick={() => setSelection({ hoveredId: null, selectedId: null })}
            className="ml-auto shrink-0 self-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 transition-colors hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
          >
            {t("Latest")}
          </button>
        )}
      </div>
      <InteractiveVitalChart
        kind={kind}
        points={points}
        compact
        title={t(kind)}
        selection={selection}
        onSelectionChange={setSelection}
      />
    </div>
  );
}

function DashCard({
  title,
  action,
  children,
  collapsible,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  collapsible?: boolean;
}) {
  if (collapsible) {
    return (
      <details className="group rounded-md border border-line bg-surface p-4 shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold text-fg">
          <span>{title}</span>
          <div className="flex items-center gap-1">
            {action}
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              className="text-fg-faint transition-transform group-open:rotate-90"
            >
              <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </summary>
        <div className="mt-3">{children}</div>
      </details>
    );
  }

  return (
    <div className="rounded-md border border-line bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-fg">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function ClampedText({ value }: { value: string | null }) {
  const t = useTranslation();
  if (!value) return <EmptyNote text={t("None recorded.")} />;
  return <p className="whitespace-pre-wrap text-sm text-fg">{value}</p>;
}

function PlanRow({ label, entry }: { label: string; entry: PlanEntry }) {
  const t = useTranslation();
  return (
    <div>
      <dt className="text-xs font-medium text-fg-subtle">{label}</dt>
      {entry ? (
        <dd className="text-sm text-fg">
          {entry.value}
          <span className="block text-xs text-fg-faint">{formatDate(entry.entry_timestamp)}</span>
        </dd>
      ) : (
        <dd className="text-sm text-fg-faint">{t("No entry yet")}</dd>
      )}
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <p className="text-sm text-fg-faint">{text}</p>;
}
