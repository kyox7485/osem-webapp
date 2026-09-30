"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { NewProgressNoteForm } from "./new-progress-note-form";
import { useNavPush } from "@/components/nav-loading";
import type { LookupOption } from "@/lib/types";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { ListChecks, Plus } from "lucide-react";
import { useIsHqAdmin } from "@/components/admin-record-controls";
import { BranchFilterSelect } from "./branch-filter-select";
import { ResultNotice } from "./result-notice";
import { ProgressNotesTimeline, type ProgressNoteRow } from "./progress-notes-timeline";

type ProgressNote = {
  id: number;
  resident_id: number;
  entry_timestamp: string;
  progress_note: string | null;
  physical_examination: string | null;
  medical_plan: string | null;
  nursing_plan: string | null;
  feeding_plan: string | null;
  monitoring_plan: string | null;
  dressing_plan: string | null;
  physio_plan: string | null;
  reviewed_by: string | null;
  reviewed_by_other: string | null;
  created_by: string | null;
  created_by_other: string | null;
  tbl_residents: { id: number; resident_name: string; branch_id: number } | null;
  reviewer: { StaffID: string; staff_name: string } | null;
  author: { StaffID: string; staff_name: string } | null;
};

type Resident = {
  id: number;
  resident_name: string;
  branch_id: number;
};

type Props = {
  notes: ProgressNote[];
  residents: Resident[];
  branches: LookupOption[];
  currentBranch: string;
  allStaff: (LookupOption & { branch_id: number })[];
  currentResident: string;
  currentStart: string;
  currentEnd: string;
  error: string | null;
  /** The server hit its row cap -- the list below is the most recent N, not all. */
  truncated?: boolean;
};

type DurPreset = "1m" | "3m" | "6m" | "1y" | "all" | "custom";

const DUR_PRESETS: { key: DurPreset; label: string }[] = [
  { key: "1m", label: "1 Month" },
  { key: "3m", label: "3 Months" },
  { key: "6m", label: "6 Months" },
  { key: "1y", label: "1 Year" },
  { key: "all", label: "All History" },
  { key: "custom", label: "Custom" },
];

function getMytToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date());
}

function subtractMonths(months: number, fromDate: string): string {
  const [y, m, d] = fromDate.split("-").map(Number);
  const date = new Date(y, m - 1 - months, d);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(date);
}

function detectPreset(start: string, end: string): DurPreset {
  if (!start && !end) return "all";
  const today = getMytToday();
  if (end && end !== today) return "custom";
  const effectiveEnd = end || today;
  if (start === subtractMonths(1, effectiveEnd)) return "1m";
  if (start === subtractMonths(3, effectiveEnd)) return "3m";
  if (start === subtractMonths(6, effectiveEnd)) return "6m";
  if (start === subtractMonths(12, effectiveEnd)) return "1y";
  return "custom";
}

export function ProgressNotesModule({
  notes,
  residents,
  branches,
  currentBranch,
  allStaff,
  currentResident,
  currentStart,
  currentEnd,
  error,
  truncated,
}: Props) {
  const router = useRouter();
  const push = useNavPush();
  const t = useTranslation();
  const isHqAdmin = useIsHqAdmin();
  const { guardedAction } = useSafeNavigation();
  const [innerTab, setInnerTab] = useState<"review" | "new">("review");
  const hasAppliedDefault = useRef(false);

  const activeDur = detectPreset(currentStart, currentEnd);

  function applyFilters(residentId: string, start: string, end: string, branchId: string) {
    const params = new URLSearchParams();
    params.set("tab", "progress-notes");
    if (branchId) params.set("branch", branchId);
    if (residentId) params.set("resident", residentId);
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    push(`/clinical?${params.toString()}`);
  }

  function applyPreset(preset: DurPreset) {
    const today = getMytToday();
    if (preset === "all") {
      applyFilters(currentResident, "", "", currentBranch);
    } else if (preset === "1m") {
      applyFilters(currentResident, subtractMonths(1, today), today, currentBranch);
    } else if (preset === "3m") {
      applyFilters(currentResident, subtractMonths(3, today), today, currentBranch);
    } else if (preset === "6m") {
      applyFilters(currentResident, subtractMonths(6, today), today, currentBranch);
    } else if (preset === "1y") {
      applyFilters(currentResident, subtractMonths(12, today), today, currentBranch);
    }
    // "custom" — no auto-apply; user edits dates manually via the inputs
  }

  // Apply 3-month default on mount when no date filter is set in the URL yet
  useEffect(() => {
    if (hasAppliedDefault.current) return;
    hasAppliedDefault.current = true;
    if (!currentStart && !currentEnd) {
      applyPreset("3m");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const noteRows: ProgressNoteRow[] = notes.map((note) => ({
    id: note.id,
    entry_timestamp: note.entry_timestamp,
    progress_note: note.progress_note,
    physical_examination: note.physical_examination,
    medical_plan: note.medical_plan,
    nursing_plan: note.nursing_plan,
    feeding_plan: note.feeding_plan,
    monitoring_plan: note.monitoring_plan,
    dressing_plan: note.dressing_plan,
    physio_plan: note.physio_plan,
    reviewed_by: note.reviewed_by,
    reviewed_by_other: note.reviewed_by_other,
    created_by: note.created_by,
    created_by_other: note.created_by_other,
    reviewer: note.reviewer,
    author: note.author,
    residentName: note.tbl_residents?.resident_name ?? undefined,
  }));

  return (
    <div className="space-y-4">
      <TabRow>
        <TabButton
          icon={ListChecks}
          size="sm"
          active={innerTab === "review"}
          onClick={() => guardedAction(() => setInnerTab("review"))}
        >
          {t("Review Notes")}
        </TabButton>
        <TabButton icon={Plus} size="sm" active={innerTab === "new"} onClick={() => setInnerTab("new")}>
          {t("New Entry")}
        </TabButton>
      </TabRow>

      {innerTab === "review" ? (
        <>
          {/* Filters */}
          <div className="rounded-md border border-line bg-surface p-4 shadow-sm">
            <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${isHqAdmin ? "lg:grid-cols-3" : ""}`}>
              <BranchFilterSelect
                branches={branches}
                currentBranch={currentBranch}
                onChange={(branchId) => applyFilters("", currentStart, currentEnd, branchId)}
                id="pn-branch-filter"
              />
              <div>
                <label htmlFor="resident-filter" className="mb-1 block text-sm font-medium text-fg-secondary">
                  {t("Resident")}
                </label>
                <select
                  id="resident-filter"
                  value={currentResident}
                  onChange={(e) => applyFilters(e.target.value, currentStart, currentEnd, currentBranch)}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">{t("All residents")}</option>
                  {residents.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.resident_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Duration selector */}
            <div className="mt-4">
              <div className="flex flex-wrap gap-2">
                {DUR_PRESETS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyPreset(key)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      activeDur === key
                        ? "bg-indigo-600 text-white"
                        : "bg-surface-muted text-fg-secondary hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-300"
                    }`}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom date inputs — only visible in custom mode */}
            {activeDur === "custom" && (
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="start-date" className="mb-1 block text-sm font-medium text-fg-secondary">
                    {t("Start date")}
                  </label>
                  <input
                    type="date"
                    id="start-date"
                    value={currentStart}
                    onChange={(e) => applyFilters(currentResident, e.target.value, currentEnd, currentBranch)}
                    className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label htmlFor="end-date" className="mb-1 block text-sm font-medium text-fg-secondary">
                    {t("End date")}
                  </label>
                  <input
                    type="date"
                    id="end-date"
                    value={currentEnd}
                    onChange={(e) => applyFilters(currentResident, currentStart, e.target.value, currentBranch)}
                    className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}
          </div>

          <ResultNotice error={error} truncated={truncated} />

          {/* Latest Clinical Status summarises a single resident's newest note, so
              it is only meaningful when the picker has narrowed to one resident. */}
          <ProgressNotesTimeline notes={noteRows} t={t} showLatestStatus={Boolean(currentResident)} />
        </>
      ) : (
        <NewProgressNoteForm
          residents={residents}
          allStaff={allStaff}
          presetResidentId={currentResident || undefined}
          onSaved={() => {
            setInnerTab("review");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
