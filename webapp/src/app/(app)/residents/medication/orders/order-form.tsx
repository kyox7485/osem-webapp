"use client";

import { useState, useTransition, useMemo, useRef, useEffect } from "react";
import { useNavPush } from "@/components/nav-loading";
import { useTranslation } from "@/components/language-provider";
import { createOrderAction, updateOrderAction, type OrderFormValues } from "./order-actions";
import { StaffPickerWithOther, OTHERS_SENTINEL } from "@/components/staff-picker-with-other";
import type { LookupOption } from "@/lib/types";

// ── Constants ────────────────────────────────────────────────────────────────

const DOSAGE_FORM_OPTIONS = [
  "Tablet", "Capsule", "Powder", "Syrup", "Cream", "Ointment", "Lotion",
  "Gel", "Patch", "Ear Drop", "Eye Drop", "S/C Injection", "I/M Injection", "Neb.", "Inhaler",
];

const UNIT_OPTIONS = ["Tablet", "Capsule", "ml", "Sachet", "Unit", "Application", "Ampoule", "Puff", "Drop"];

const FREQUENCY_OPTIONS = ["OD", "BD", "TDS", "QID", "ON", "EOD", "Every 3 Days", "PRN", "Selected Days", "Others"];

const DAY_OPTIONS = ["Everyday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// All hours round the clock in medication format e.g. 0800AM, 0600PM
const TIME_SLOTS = [
  "1200AM", "0100AM", "0200AM", "0300AM", "0400AM", "0500AM",
  "0600AM", "0700AM", "0800AM", "0900AM", "1000AM", "1100AM",
  "1200PM", "0100PM", "0200PM", "0300PM", "0400PM", "0500PM",
  "0600PM", "0700PM", "0800PM", "0900PM", "1000PM", "1100PM",
];

const FREQ_TIME_DEFAULTS: Record<string, string[]> = {
  OD:  ["0800AM"],
  BD:  ["0800AM", "0600PM"],
  TDS: ["0800AM", "1200PM", "0600PM"],
  QID: ["0800AM", "1200PM", "0600PM", "1000PM"],
  ON:  ["1000PM"],
};

// ── Types ─────────────────────────────────────────────────────────────────────

export type ResidentOption = {
  id: number;
  name: string;
  residentTextId: string;
  branchId: number;
};

export type StaffEntry = {
  name: string;
  branchId: number;
};

type Props =
  | {
      mode: "create";
      residents: ResidentOption[];
      staffOptions: StaffEntry[];
    }
  | {
      mode: "edit";
      rxOrderId: string;
      residentDisplay: string;
      residentBranchId: number;
      initialValues: Omit<OrderFormValues, "residentId">;
      staffOptions: StaffEntry[];
    };

const NO_RESIDENTS: ResidentOption[] = [];

// ── Sub-components ────────────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:bg-gray-50 disabled:text-gray-400";

const labelCls = "block text-xs font-medium text-gray-600 mb-1";

function Field({
  label,
  required,
  children,
  span2,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  span2?: boolean;
}) {
  return (
    <div className={span2 ? "sm:col-span-2" : ""}>
      <label className={labelCls}>
        {label}
        {required && <span className="ml-0.5 text-red-500"> *</span>}
      </label>
      {children}
    </div>
  );
}

function SectionHeading({ title }: { title: string }) {
  return (
    <h3 className="col-span-full text-xs font-semibold uppercase tracking-wide text-gray-400 mt-2 mb-1 border-b border-gray-100 pb-1">
      {title}
    </h3>
  );
}

function ToggleGroup({
  options,
  value,
  onChange,
  disabled,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          disabled={disabled}
          className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50
            ${value === opt
              ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
              : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
            }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function ChipSelector({
  options,
  selected,
  onToggle,
  disabled,
}: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const isSelected = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            disabled={disabled}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40
              ${isSelected
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-gray-200 bg-white text-gray-600 hover:border-indigo-300 hover:bg-indigo-50"
              }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function OrderForm(props: Props) {
  const t = useTranslation();
  const push = useNavPush();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);

  const isCreate = props.mode === "create";

  const init =
    props.mode === "edit"
      ? props.initialValues
      : {
          dosageForm: "",
          brandName: "",
          activeIngredient: "",
          dose: "",
          unit: "",
          frequency: "",
          administrationTimes: "",
          dosingDays: "",
          indication: "",
          instruction: "",
          durationType: "",
          startDate: new Date().toISOString().split("T")[0],
          endDate: "",
          notedBy: "",
          orderedBy: "",
          suppliedBy: "",
          status: "Active",
          previousRxOrderId: "",
        };

  // ── Resident combobox (create mode) ─────────────────────────────────────────
  const [residentId, setResidentId] = useState("");
  const [residentSearch, setResidentSearch] = useState("");
  const [residentDropOpen, setResidentDropOpen] = useState(false);
  const residentInputRef = useRef<HTMLInputElement>(null);

  // ── Dosage form — dropdown + "Others" specify ────────────────────────────────
  const initIsOtherDosage =
    !!init.dosageForm && !DOSAGE_FORM_OPTIONS.includes(init.dosageForm);
  const [dosageForm, setDosageForm] = useState(
    initIsOtherDosage ? "Others" : init.dosageForm
  );
  const [dosageFormOther, setDosageFormOther] = useState(
    initIsOtherDosage ? init.dosageForm : ""
  );

  // ── Drug info ────────────────────────────────────────────────────────────────
  const [brandName, setBrandName] = useState(init.brandName);
  const [activeIngredient, setActiveIngredient] = useState(init.activeIngredient);

  // ── Dosing ───────────────────────────────────────────────────────────────────
  const [dose, setDose] = useState(init.dose);
  const [unit, setUnit] = useState(init.unit);
  const [frequency, setFrequency] = useState(init.frequency);

  const [adminTimes, setAdminTimes] = useState<string[]>(() => {
    if (!init.administrationTimes) return [];
    return init.administrationTimes.split(",").map((s) => s.trim()).filter(Boolean);
  });

  const [dosingDays, setDosingDays] = useState<string[]>(() => {
    if (!init.dosingDays) return ["Everyday"];
    const parts = init.dosingDays.split(",").map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts : ["Everyday"];
  });

  // ── Clinical ─────────────────────────────────────────────────────────────────
  const [indication, setIndication] = useState(init.indication);
  const [instruction, setInstruction] = useState(init.instruction);

  // ── Duration & Dates ─────────────────────────────────────────────────────────
  const [durationType, setDurationType] = useState(init.durationType);
  const [startDate, setStartDate] = useState(init.startDate);
  const [endDate, setEndDate] = useState(init.endDate);

  // ── Personnel ────────────────────────────────────────────────────────────────
  const [orderedBy, setOrderedBy] = useState(init.orderedBy);
  const [suppliedBy, setSuppliedBy] = useState(init.suppliedBy);

  // Noted By — staff picker uses staff name as option value (stored directly in Sheet)
  const initNotedByIsOther =
    !!init.notedBy && !props.staffOptions.some((s) => s.name === init.notedBy);
  const [notedByVal, setNotedByVal] = useState(
    initNotedByIsOther ? OTHERS_SENTINEL : init.notedBy
  );
  const [notedByOther, setNotedByOther] = useState(
    initNotedByIsOther ? init.notedBy : ""
  );

  // ── Dirty tracking ────────────────────────────────────────────────────────────
  function mark() {
    setIsDirty(true);
  }

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const residents = isCreate ? props.residents : NO_RESIDENTS;
  const filteredResidents = useMemo(() => {
    const q = residentSearch.toLowerCase();
    if (!q) return residents;
    return residents.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.residentTextId.toLowerCase().includes(q)
    );
  }, [residents, residentSearch]);

  const selectedResident = residents.find((r) => String(r.id) === residentId);

  const showDosingDays = frequency === "Selected Days" || frequency === "Others";
  const showEndDate = durationType === "Short Term";
  const adminTimesRequired = !!frequency && frequency !== "PRN";

  // Staff options for Noted By — filter to the relevant branch
  const staffFilterBranchId =
    props.mode === "edit"
      ? props.residentBranchId
      : (selectedResident?.branchId ?? null);

  const notedByStaffOptions: LookupOption[] = useMemo(() => {
    if (!staffFilterBranchId) return [];
    return props.staffOptions
      .filter((s) => s.branchId === staffFilterBranchId)
      .map((s) => ({ id: s.name, label: s.name }));
  }, [props.staffOptions, staffFilterBranchId]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleFrequencyChange(newFreq: string) {
    setFrequency(newFreq);
    mark();
    if (FREQ_TIME_DEFAULTS[newFreq]) {
      setAdminTimes(FREQ_TIME_DEFAULTS[newFreq]);
    } else if (newFreq === "PRN") {
      setAdminTimes([]);
    }
  }

  function toggleAdminTime(time: string) {
    setAdminTimes((prev) =>
      prev.includes(time) ? prev.filter((t) => t !== time) : [...prev, time]
    );
    mark();
  }

  function toggleDosingDay(day: string) {
    setDosingDays((prev) => {
      if (day === "Everyday") return ["Everyday"];
      const without = prev.filter((d) => d !== "Everyday");
      return without.includes(day) ? without.filter((d) => d !== day) : [...without, day];
    });
    mark();
  }

  // ── Build values ─────────────────────────────────────────────────────────────

  function buildValues(): OrderFormValues {
    return {
      residentId,
      dosageForm: dosageForm === "Others" ? dosageFormOther.trim() : dosageForm,
      brandName: brandName.trim(),
      activeIngredient: activeIngredient.trim(),
      dose,
      unit,
      frequency,
      administrationTimes: adminTimes.join(","),
      dosingDays: dosingDays.join(","),
      indication: indication.trim(),
      instruction: instruction.trim(),
      durationType,
      startDate,
      endDate: durationType === "Short Term" ? endDate : "",
      notedBy: notedByVal === OTHERS_SENTINEL ? notedByOther.trim() : notedByVal,
      orderedBy,
      suppliedBy,
      status: "Active",
      previousRxOrderId: init.previousRxOrderId || "",
    };
  }

  // ── Submit ───────────────────────────────────────────────────────────────────

  function doSubmit() {
    setError(null);
    setSuccessId(null);

    startTransition(async () => {
      if (isCreate) {
        const result = await createOrderAction(buildValues());
        if (!result.success) {
          setError(result.error ?? "Unknown error");
          return;
        }
        setIsDirty(false);
        setSuccessId(result.rxOrderId ?? null);
        setTimeout(() => push("/residents/medication/orders"), 1800);
      } else {
        const { residentId: _rid, ...rest } = buildValues();
        void _rid;
        const result = await updateOrderAction(
          (props as Extract<Props, { mode: "edit" }>).rxOrderId,
          rest
        );
        if (!result.success) {
          setError(result.error ?? "Unknown error");
          return;
        }
        setIsDirty(false);
        push("/residents/medication/orders");
      }
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    doSubmit();
  }

  function handleCancel() {
    if (isDirty) {
      setShowCancelModal(true);
    } else {
      push("/residents/medication/orders");
    }
  }

  // ── Success ──────────────────────────────────────────────────────────────────

  if (successId) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-6 py-8 text-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="mx-auto mb-3 h-8 w-8 text-green-500"
        >
          <path
            fillRule="evenodd"
            d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z"
            clipRule="evenodd"
          />
        </svg>
        <p className="text-sm font-semibold text-green-800">
          {t("Order submitted successfully.")}
        </p>
        <p className="mt-1 font-mono text-xs text-green-600">
          {t("Order ID")}: {successId}
        </p>
        <p className="mt-2 text-xs text-green-600">{t("Redirecting...")}</p>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Unsaved changes modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-sm font-semibold text-gray-900">
              {t("Unsaved Changes")}
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              {t("You have unsaved changes. What would you like to do?")}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={() => {
                  setShowCancelModal(false);
                  doSubmit();
                }}
                disabled={isPending}
                className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {t("Save and Exit")}
              </button>
              <button
                onClick={() => {
                  setIsDirty(false);
                  setShowCancelModal(false);
                  push("/residents/medication/orders");
                }}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                {t("Exit Without Saving")}
              </button>
              <button
                onClick={() => setShowCancelModal(false)}
                className="py-1 text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                {t("Cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">

            {/* ── Resident ────────────────────────────────────────────────────── */}
            <SectionHeading title={t("Resident")} />

            {isCreate ? (
              <div className="sm:col-span-2 relative">
                <Field label={t("Resident")} required>
                  <div className="relative">
                    <input
                      ref={residentInputRef}
                      type="text"
                      value={
                        selectedResident
                          ? `${selectedResident.residentTextId} – ${selectedResident.name}`
                          : residentSearch
                      }
                      onChange={(e) => {
                        if (selectedResident) setResidentId("");
                        setResidentSearch(e.target.value);
                        setResidentDropOpen(true);
                        mark();
                      }}
                      onFocus={() => setResidentDropOpen(true)}
                      onBlur={() =>
                        setTimeout(() => setResidentDropOpen(false), 150)
                      }
                      placeholder={t("Search by name or ID...")}
                      className={inputCls}
                      autoComplete="off"
                    />
                    {residentDropOpen && filteredResidents.length > 0 && (
                      <ul className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg text-sm">
                        {filteredResidents.slice(0, 30).map((r) => (
                          <li
                            key={r.id}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setResidentId(String(r.id));
                              setResidentSearch("");
                              setResidentDropOpen(false);
                              residentInputRef.current?.blur();
                              mark();
                            }}
                            className="cursor-pointer px-3 py-2 hover:bg-indigo-50"
                          >
                            <span className="font-medium text-gray-900">
                              {r.name}
                            </span>
                            <span className="ml-2 text-xs text-gray-400">
                              {r.residentTextId}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Field>
              </div>
            ) : (
              <div className="sm:col-span-2">
                <p className={labelCls}>{t("Resident")}</p>
                <p className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  {(props as Extract<Props, { mode: "edit" }>).residentDisplay}
                </p>
              </div>
            )}

            {/* ── Drug Information ─────────────────────────────────────────────── */}
            <SectionHeading title={t("Drug Information")} />

            <div className="sm:col-span-2">
              <Field label={t("Active Ingredient")} required>
                <input
                  type="text"
                  value={activeIngredient}
                  onChange={(e) => {
                    setActiveIngredient(e.target.value);
                    mark();
                  }}
                  placeholder={t("e.g. Atorvastatin")}
                  className={inputCls}
                />
              </Field>
            </div>

            <Field label={t("Brand Name")}>
              <input
                type="text"
                value={brandName}
                onChange={(e) => {
                  setBrandName(e.target.value);
                  mark();
                }}
                placeholder={t("Optional")}
                className={inputCls}
              />
            </Field>

            <Field label={t("Dosage Form")} required>
              <select
                value={dosageForm}
                onChange={(e) => {
                  setDosageForm(e.target.value);
                  mark();
                }}
                className={inputCls + " cursor-pointer"}
              >
                <option value="">{t("Select dosage form")}</option>
                {DOSAGE_FORM_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {t(o)}
                  </option>
                ))}
                <option value="Others">{t("Others (please specify)")}</option>
              </select>
              {dosageForm === "Others" && (
                <input
                  type="text"
                  value={dosageFormOther}
                  onChange={(e) => {
                    setDosageFormOther(e.target.value);
                    mark();
                  }}
                  placeholder={t("Please specify...")}
                  className={inputCls + " mt-2"}
                />
              )}
            </Field>

            {/* ── Dosing ──────────────────────────────────────────────────────── */}
            <SectionHeading title={t("Dosing")} />

            <Field label={t("Dose")} required>
              <input
                type="number"
                value={dose}
                onChange={(e) => {
                  setDose(e.target.value);
                  mark();
                }}
                placeholder="e.g. 10"
                min="0.01"
                step="0.01"
                className={inputCls}
              />
            </Field>

            <Field label={t("Unit")} required>
              <select
                value={unit}
                onChange={(e) => {
                  setUnit(e.target.value);
                  mark();
                }}
                className={inputCls + " cursor-pointer"}
              >
                <option value="">{t("Select unit")}</option>
                {UNIT_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {t(o)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t("Frequency")} required>
              <select
                value={frequency}
                onChange={(e) => handleFrequencyChange(e.target.value)}
                className={inputCls + " cursor-pointer"}
              >
                <option value="">{t("Select frequency")}</option>
                {FREQUENCY_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {t(o)}
                  </option>
                ))}
              </select>
            </Field>

            {/* Spacer to keep grid balanced */}
            <div className="hidden sm:block" />

            <div className="sm:col-span-2">
              <Field label={t("Administration Times")} required={adminTimesRequired}>
                <div className="mt-1">
                  <ChipSelector
                    options={TIME_SLOTS}
                    selected={adminTimes}
                    onToggle={toggleAdminTime}
                    disabled={!frequency}
                  />
                  {frequency === "PRN" && (
                    <p className="mt-1.5 text-xs text-gray-400">
                      {t("Not required for PRN frequency.")}
                    </p>
                  )}
                  {!frequency && (
                    <p className="mt-1.5 text-xs text-gray-400">
                      {t("Select a frequency first.")}
                    </p>
                  )}
                </div>
              </Field>
            </div>

            {showDosingDays && (
              <div className="sm:col-span-2">
                <Field label={t("Dosing Days")} required>
                  <div className="mt-1">
                    <ChipSelector
                      options={DAY_OPTIONS}
                      selected={dosingDays}
                      onToggle={toggleDosingDay}
                    />
                  </div>
                </Field>
              </div>
            )}

            {/* ── Clinical ────────────────────────────────────────────────────── */}
            <SectionHeading title={t("Clinical")} />

            <Field label={t("Indication")}>
              <input
                type="text"
                value={indication}
                onChange={(e) => {
                  setIndication(e.target.value);
                  mark();
                }}
                placeholder={t("e.g. Hypertension")}
                className={inputCls}
              />
            </Field>

            <div className="sm:col-span-2">
              <Field label={t("Instruction")}>
                <textarea
                  value={instruction}
                  onChange={(e) => {
                    setInstruction(e.target.value);
                    mark();
                  }}
                  rows={2}
                  placeholder={t("e.g. Take after meal")}
                  className={inputCls}
                />
              </Field>
            </div>

            {/* ── Duration & Dates ─────────────────────────────────────────────── */}
            <SectionHeading title={t("Duration & Dates")} />

            <div className="sm:col-span-2">
              <Field label={t("Duration Type")} required>
                <div className="mt-1 sm:max-w-xs">
                  <ToggleGroup
                    options={["Long Term", "Short Term"]}
                    value={durationType}
                    onChange={(v) => {
                      setDurationType(v);
                      mark();
                    }}
                  />
                </div>
              </Field>
            </div>

            <Field label={t("Start Date")} required>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  mark();
                }}
                className={inputCls}
              />
            </Field>

            {showEndDate && (
              <Field label={t("End Date")} required>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    mark();
                  }}
                  min={startDate || undefined}
                  className={inputCls}
                />
              </Field>
            )}

            {/* ── Personnel ───────────────────────────────────────────────────── */}
            <SectionHeading title={t("Personnel")} />

            <Field label={t("Ordered By")} required>
              <div className="mt-1">
                <ToggleGroup
                  options={["OSEM Medical Team", "Family"]}
                  value={orderedBy}
                  onChange={(v) => {
                    setOrderedBy(v);
                    mark();
                  }}
                />
              </div>
            </Field>

            <Field label={t("Supplied By")} required>
              <div className="mt-1">
                <ToggleGroup
                  options={["OSEM", "Family"]}
                  value={suppliedBy}
                  onChange={(v) => {
                    setSuppliedBy(v);
                    mark();
                  }}
                />
              </div>
            </Field>

            <Field label={t("Noted By")}>
              <StaffPickerWithOther
                value={notedByVal}
                otherName={notedByOther}
                onValueChange={(v) => {
                  setNotedByVal(v);
                  mark();
                }}
                onOtherNameChange={(v) => {
                  setNotedByOther(v);
                  mark();
                }}
                staffOptions={notedByStaffOptions}
                disabled={isCreate && !residentId}
              />
              {isCreate && !residentId && (
                <p className="mt-1 text-xs text-gray-400">
                  {t("Select a resident first.")}
                </p>
              )}
            </Field>

            {/* ── Reference (edit only) ────────────────────────────────────────── */}
            {props.mode === "edit" && (
              <>
                <SectionHeading title={t("Reference")} />
                <div className="sm:col-span-2">
                  <p className={labelCls}>{t("Order ID")}</p>
                  <p className="font-mono text-sm text-gray-500">
                    {(props as Extract<Props, { mode: "edit" }>).rxOrderId}
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-5 py-4 rounded-b-lg">
            {error && (
              <p className="flex-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="flex gap-2 ml-auto">
              <button
                type="button"
                onClick={handleCancel}
                disabled={isPending}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {t("Cancel")}
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {isPending ? (
                  <>
                    <svg
                      className="h-4 w-4 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v8H4z"
                      />
                    </svg>
                    {t("Saving...")}
                  </>
                ) : isCreate ? (
                  t("Create Order")
                ) : (
                  t("Save Changes")
                )}
              </button>
            </div>
          </div>
        </div>
      </form>
    </>
  );
}
