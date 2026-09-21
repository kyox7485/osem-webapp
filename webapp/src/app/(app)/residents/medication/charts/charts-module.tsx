"use client";

import { useState, useMemo, useRef } from "react";
import { User, Building2, ExternalLink, AlertCircle, CheckCircle2 } from "lucide-react";
import { TabRow, TabButton } from "@/components/tabs";
import { MEDICATION_CHART_SCRIPT_URL } from "@/config/medication-chart";

type ResidentOption = {
  residentId: string; // ResidentID text field, e.g. "BMN-0002"
  name: string;
};

type BranchOption = {
  id: number;
  name: string; // canonical branch name sent to Apps Script, e.g. "KOTA PERMAI"
};

type Props = {
  residents: ResidentOption[];
  branches: BranchOption[];
  defaultYear: number;
  defaultMonth: number; // 1-indexed
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type MessageKind = "info" | "error" | "success";

export function MedicationChartsModule({
  residents,
  branches,
  defaultYear,
  defaultMonth,
}: Props) {
  const [mode, setMode] = useState<"resident" | "branch">("resident");

  // ── Resident chart state ─────────────────────────────────────────────────
  const [selectedResidentId, setSelectedResidentId] = useState<string>("");
  const [selectedResidentName, setSelectedResidentName] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── Branch chart state ───────────────────────────────────────────────────
  const [selectedBranchId, setSelectedBranchId] = useState<number | "">(
    branches.length === 1 ? branches[0].id : ""
  );

  // ── Shared chart period ──────────────────────────────────────────────────
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);

  // ── Branch chart confirmation ────────────────────────────────────────────
  const [showBranchConfirm, setShowBranchConfirm] = useState(false);

  // ── Status message ───────────────────────────────────────────────────────
  const [message, setMessage] = useState<{ text: string; kind: MessageKind } | null>(null);

  // Year range: two years back, one year ahead
  const yearOptions = [
    defaultYear - 2,
    defaultYear - 1,
    defaultYear,
    defaultYear + 1,
  ];

  // ── Resident search ──────────────────────────────────────────────────────
  const filteredResidents = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return residents.slice(0, 60);
    return residents
      .filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.residentId.toLowerCase().includes(q)
      )
      .slice(0, 60);
  }, [residents, searchQuery]);

  const inputDisplayValue = selectedResidentId
    ? selectedResidentName
    : searchQuery;

  function handleSearchInput(e: React.ChangeEvent<HTMLInputElement>) {
    setSearchQuery(e.target.value);
    setSelectedResidentId("");
    setSelectedResidentName("");
    setDropdownOpen(true);
    setMessage(null);
  }

  function handleSelectResident(r: ResidentOption) {
    setSelectedResidentId(r.residentId);
    setSelectedResidentName(r.name);
    setSearchQuery("");
    setDropdownOpen(false);
    setMessage(null);
  }

  function handleSearchFocus() {
    if (!selectedResidentId) setDropdownOpen(true);
  }

  function handleSearchBlur() {
    // Delay so mouseDown on a list item fires first.
    setTimeout(() => setDropdownOpen(false), 150);
  }

  function clearResident() {
    setSelectedResidentId("");
    setSelectedResidentName("");
    setSearchQuery("");
    setDropdownOpen(false);
    setMessage(null);
    searchInputRef.current?.focus();
  }

  // ── Generate resident chart ───────────────────────────────────────────────
  function generateResidentChart() {
    if (!selectedResidentId) {
      setMessage({ text: "Please select a resident.", kind: "error" });
      return;
    }
    const url = new URL(MEDICATION_CHART_SCRIPT_URL);
    url.searchParams.set("residentID", selectedResidentId);
    url.searchParams.set("year", String(year));
    url.searchParams.set("month", String(month));
    const win = window.open(url.toString(), "_blank", "noopener,noreferrer");
    if (!win) {
      setMessage({
        text: "The browser blocked the new tab. Please allow pop-ups for this site and try again.",
        kind: "error",
      });
    } else {
      setMessage({
        text: "Medication chart generator opened in a new tab.",
        kind: "success",
      });
    }
  }

  // ── Branch chart: selected branch name ───────────────────────────────────
  const selectedBranch =
    selectedBranchId !== ""
      ? branches.find((b) => b.id === selectedBranchId) ?? null
      : null;

  function handleGenerateBranchClick() {
    if (!selectedBranch) {
      setMessage({ text: "Please select a branch.", kind: "error" });
      return;
    }
    setShowBranchConfirm(true);
    setMessage(null);
  }

  function confirmBranchChart() {
    if (!selectedBranch) return;
    const url = new URL(MEDICATION_CHART_SCRIPT_URL);
    url.searchParams.set("action", "branchchart");
    url.searchParams.set("branch", selectedBranch.name);
    url.searchParams.set("year", String(year));
    url.searchParams.set("month", String(month));
    const win = window.open(url.toString(), "_blank", "noopener,noreferrer");
    setShowBranchConfirm(false);
    if (!win) {
      setMessage({
        text: "The browser blocked the new tab. Please allow pop-ups for this site and try again.",
        kind: "error",
      });
    } else {
      setMessage({
        text: "Medication chart generator opened in a new tab.",
        kind: "success",
      });
    }
  }

  function switchMode(next: "resident" | "branch") {
    setMode(next);
    setMessage(null);
    setShowBranchConfirm(false);
  }

  return (
    <div className="rounded-md border border-gray-200 bg-white shadow-sm">
      {/* Mode tabs */}
      <div className="border-b border-gray-100 px-5 py-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">
          Medication Charts
        </h2>
        <TabRow>
          <TabButton
            size="sm"
            icon={User}
            active={mode === "resident"}
            onClick={() => switchMode("resident")}
          >
            Resident Chart
          </TabButton>
          <TabButton
            size="sm"
            icon={Building2}
            active={mode === "branch"}
            onClick={() => switchMode("branch")}
          >
            Branch Chart
          </TabButton>
        </TabRow>
      </div>

      <div className="px-5 py-5">
        {mode === "resident" && (
          <ResidentChartForm
            residents={residents}
            filteredResidents={filteredResidents}
            inputDisplayValue={inputDisplayValue}
            selectedResidentId={selectedResidentId}
            dropdownOpen={dropdownOpen}
            searchInputRef={searchInputRef}
            year={year}
            month={month}
            yearOptions={yearOptions}
            onSearchInput={handleSearchInput}
            onSearchFocus={handleSearchFocus}
            onSearchBlur={handleSearchBlur}
            onSelectResident={handleSelectResident}
            onClearResident={clearResident}
            onYearChange={setYear}
            onMonthChange={setMonth}
            onGenerate={generateResidentChart}
          />
        )}

        {mode === "branch" && (
          <BranchChartForm
            branches={branches}
            selectedBranchId={selectedBranchId}
            selectedBranch={selectedBranch}
            year={year}
            month={month}
            yearOptions={yearOptions}
            showConfirm={showBranchConfirm}
            onBranchChange={(id) => {
              setSelectedBranchId(id);
              setShowBranchConfirm(false);
              setMessage(null);
            }}
            onYearChange={setYear}
            onMonthChange={setMonth}
            onGenerateClick={handleGenerateBranchClick}
            onConfirm={confirmBranchChart}
            onCancelConfirm={() => setShowBranchConfirm(false)}
          />
        )}

        {/* Status message */}
        {message && (
          <div
            className={`mt-5 flex items-start gap-2 rounded-md px-4 py-3 text-sm ${
              message.kind === "error"
                ? "bg-red-50 text-red-700"
                : message.kind === "success"
                  ? "bg-green-50 text-green-700"
                  : "bg-blue-50 text-blue-700"
            }`}
          >
            {message.kind === "error" ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            {message.text}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Resident Chart form ───────────────────────────────────────────────────────

type ResidentFormProps = {
  residents: ResidentOption[];
  filteredResidents: ResidentOption[];
  inputDisplayValue: string;
  selectedResidentId: string;
  dropdownOpen: boolean;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  year: number;
  month: number;
  yearOptions: number[];
  onSearchInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSearchFocus: () => void;
  onSearchBlur: () => void;
  onSelectResident: (r: ResidentOption) => void;
  onClearResident: () => void;
  onYearChange: (y: number) => void;
  onMonthChange: (m: number) => void;
  onGenerate: () => void;
};

function ResidentChartForm({
  filteredResidents,
  inputDisplayValue,
  selectedResidentId,
  dropdownOpen,
  searchInputRef,
  year,
  month,
  yearOptions,
  onSearchInput,
  onSearchFocus,
  onSearchBlur,
  onSelectResident,
  onClearResident,
  onYearChange,
  onMonthChange,
  onGenerate,
}: ResidentFormProps) {
  return (
    <div className="space-y-5">
      {/* Resident selector */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          Resident
        </label>
        <div className="relative">
          <div className="relative flex items-center">
            <input
              ref={searchInputRef}
              type="text"
              value={inputDisplayValue}
              placeholder="Search by name or resident ID…"
              autoComplete="off"
              className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
                selectedResidentId
                  ? "border-indigo-300 bg-indigo-50 text-gray-900 focus:border-indigo-500 focus:ring-indigo-500"
                  : "border-gray-300 bg-white text-gray-900 focus:border-indigo-500 focus:ring-indigo-500"
              }`}
              onChange={onSearchInput}
              onFocus={onSearchFocus}
              onBlur={onSearchBlur}
            />
            {selectedResidentId && (
              <button
                type="button"
                className="absolute right-2 text-gray-400 hover:text-gray-600"
                onClick={onClearResident}
                tabIndex={-1}
                aria-label="Clear selection"
              >
                ×
              </button>
            )}
          </div>

          {/* Selected badge */}
          {selectedResidentId && (
            <p className="mt-1 text-xs text-indigo-600">
              ID: {selectedResidentId}
            </p>
          )}

          {/* Dropdown */}
          {dropdownOpen && (
            <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg">
              {filteredResidents.length === 0 ? (
                <li className="px-3 py-2 text-sm text-gray-400">
                  No residents found.
                </li>
              ) : (
                filteredResidents.map((r) => (
                  <li
                    key={r.residentId}
                    className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm hover:bg-indigo-50"
                    onMouseDown={(e) => {
                      e.preventDefault(); // keep input focus until selection
                      onSelectResident(r);
                    }}
                  >
                    <span className="font-medium text-gray-900">{r.name}</span>
                    <span className="ml-3 shrink-0 text-xs text-gray-400">
                      {r.residentId}
                    </span>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      </div>

      {/* Chart period */}
      <ChartPeriodPicker
        year={year}
        month={month}
        yearOptions={yearOptions}
        onYearChange={onYearChange}
        onMonthChange={onMonthChange}
      />

      {/* Generate button */}
      <div className="pt-1">
        <button
          type="button"
          disabled={!selectedResidentId}
          onClick={onGenerate}
          className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ExternalLink className="h-4 w-4" />
          Generate Medication Chart
        </button>
      </div>
    </div>
  );
}

// ── Branch Chart form ─────────────────────────────────────────────────────────

type BranchFormProps = {
  branches: BranchOption[];
  selectedBranchId: number | "";
  selectedBranch: BranchOption | null;
  year: number;
  month: number;
  yearOptions: number[];
  showConfirm: boolean;
  onBranchChange: (id: number | "") => void;
  onYearChange: (y: number) => void;
  onMonthChange: (m: number) => void;
  onGenerateClick: () => void;
  onConfirm: () => void;
  onCancelConfirm: () => void;
};

function BranchChartForm({
  branches,
  selectedBranchId,
  selectedBranch,
  year,
  month,
  yearOptions,
  showConfirm,
  onBranchChange,
  onYearChange,
  onMonthChange,
  onGenerateClick,
  onConfirm,
  onCancelConfirm,
}: BranchFormProps) {
  return (
    <div className="space-y-5">
      {/* Branch selector */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          Branch
        </label>
        {branches.length === 0 ? (
          <p className="text-sm text-gray-400">No branches available.</p>
        ) : (
          <select
            value={selectedBranchId}
            onChange={(e) =>
              onBranchChange(e.target.value === "" ? "" : Number(e.target.value))
            }
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {branches.length > 1 && (
              <option value="">Select branch…</option>
            )}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Chart period */}
      <ChartPeriodPicker
        year={year}
        month={month}
        yearOptions={yearOptions}
        onYearChange={onYearChange}
        onMonthChange={onMonthChange}
      />

      {/* Confirmation panel */}
      {showConfirm && selectedBranch ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-4">
          <p className="mb-3 text-sm font-medium text-amber-800">
            Generate branch medication charts?
          </p>
          <dl className="mb-4 space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-amber-700">Branch:</dt>
              <dd className="font-medium text-amber-900">{selectedBranch.name}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-amber-700">Chart month:</dt>
              <dd className="font-medium text-amber-900">
                {MONTHS[month - 1]} {year}
              </dd>
            </div>
          </dl>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancelConfirm}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
            >
              <ExternalLink className="h-4 w-4" />
              Open Chart Generator
            </button>
          </div>
        </div>
      ) : (
        <div className="pt-1">
          <button
            type="button"
            disabled={!selectedBranch}
            onClick={onGenerateClick}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ExternalLink className="h-4 w-4" />
            Generate Branch Medication Charts
          </button>
        </div>
      )}
    </div>
  );
}

// ── Shared chart period picker ────────────────────────────────────────────────

type PeriodPickerProps = {
  year: number;
  month: number;
  yearOptions: number[];
  onYearChange: (y: number) => void;
  onMonthChange: (m: number) => void;
};

function ChartPeriodPicker({
  year,
  month,
  yearOptions,
  onYearChange,
  onMonthChange,
}: PeriodPickerProps) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">
        Chart Period
      </label>
      <div className="flex gap-2">
        <select
          value={year}
          onChange={(e) => onYearChange(Number(e.target.value))}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select
          value={month}
          onChange={(e) => onMonthChange(Number(e.target.value))}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {MONTHS.map((name, i) => (
            <option key={i + 1} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
