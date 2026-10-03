"use client";

import { useState, useTransition, useMemo, useRef, useEffect } from "react";
import { Combobox } from "@/components/combobox";
import { useNavPush } from "@/components/nav-loading";
import { useTranslation } from "@/components/language-provider";
import { createOrderAction, updateOrderAction, type OrderFormValues } from "./order-actions";
import { StaffPickerWithOther, OTHERS_SENTINEL } from "@/components/staff-picker-with-other";
import type { LookupOption } from "@/lib/types";
import { useDirtyForm } from "@/lib/dirty-form-context";
import {
  DOSAGE_FORM_OPTIONS,
  UNIT_OPTIONS,
  FREQUENCY_OPTIONS,
  DAY_OPTIONS,
  TIME_SLOTS,
  FREQ_TIME_DEFAULTS,
  getDefaultUnitForDosageForm,
  medInputCls as inputCls,
  medLabelCls as labelCls,
  ToggleGroup,
  ChipSelector,
} from "@/components/medication-form-shared";
import { toDatetimeLocalValue, fromDatetimeLocalValue } from "@/lib/format-date";
import { STOCK_UNITS, defaultStockUnitForOrderUnit } from "@/lib/medication-stock";
import { recordStockEntryAction } from "../stock/stock-actions";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ResidentOption = {
  id: number;
  name: string;
  residentTextId: string;
  branchId: number;
};

export type StaffEntry = {
  staffId: string;
  name: string;
  branchId: number;
  branchFunction: string;
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

function Field({
  label,
  required,
  children,
  span2,
  span3,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  span2?: boolean;
  span3?: boolean;
}) {
  return (
    <div className={span2 ? "sm:col-span-2" : span3 ? "col-span-3" : ""}>
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
    <h3 className="col-span-full text-xs font-semibold uppercase tracking-wide text-fg-faint mt-2 mb-1 border-b border-line-subtle pb-1">
      {title}
    </h3>
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
        };

  // ── Resident combobox (create mode) ─────────────────────────────────────────
  const [residentId, setResidentId] = useState("");

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

  // Noted By — the picker's value is the staff member's display name.
  const initNotedByIsOther =
    !!init.notedBy && !props.staffOptions.some((s) => s.name === init.notedBy);
  const [notedByVal, setNotedByVal] = useState(
    initNotedByIsOther ? OTHERS_SENTINEL : init.notedBy
  );
  const [notedByOther, setNotedByOther] = useState(
    initNotedByIsOther ? init.notedBy : ""
  );

  // ── Initial Stock Received (optional, create mode only) ──────────────────────
  const [stockDate, setStockDate] = useState(() => toDatetimeLocalValue(new Date().toISOString()));
  const [stockQuantity, setStockQuantity] = useState("");
  const [stockUnit, setStockUnit] = useState(() => defaultStockUnitForOrderUnit(init.unit) ?? "");
  const [stockUnitManuallySet, setStockUnitManuallySet] = useState(false);
  const [stockRegisteredBy, setStockRegisteredBy] = useState("");
  const [stockPartialError, setStockPartialError] = useState<string | null>(null);

  // ── Dirty tracking ────────────────────────────────────────────────────────────
  // Local isDirty/showCancelModal above already drive this form's own
  // Cancel-button flow (Save and Exit / Exit Without Saving / Cancel,
  // below). Mirroring the same state into the app-wide dirty-form guard
  // additionally covers sidebar links and browser refresh/close -- without
  // duplicating this form's own confirmation UI for its own Cancel button.
  const orderFormId = isCreate ? "medication-order-new" : `medication-order-edit-${(props as Extract<Props, { mode: "edit" }>).rxOrderId}`;
  const { markDirty: markGlobalDirty, markClean: markGlobalClean } = useDirtyForm(orderFormId);
  // Always points at the latest render's doSubmitAsync closure, so the
  // registration effect below (which only re-runs on isDirty flips, not on
  // every keystroke) never calls a stale save with outdated field values.
  const doSubmitRef = useRef<() => Promise<{ success: boolean; error?: string }>>(null!);

  function mark() {
    setIsDirty(true);
  }

  useEffect(() => {
    if (isDirty) {
      markGlobalDirty(() => doSubmitRef.current());
    } else {
      markGlobalClean();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty]);

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
  const residentOptions = useMemo(
    () => residents.map((r) => ({ id: r.id, label: r.name, hint: r.residentTextId })),
    [residents]
  );

  const selectedResident = residents.find((r) => String(r.id) === residentId);

  const showDosingDays = frequency === "Selected Days" || frequency === "Others";
  const showEndDate = durationType === "Short Term";
  const adminTimesRequired = !!frequency && frequency !== "PRN";

  const staffFilterBranchId =
    props.mode === "edit"
      ? props.residentBranchId
      : (selectedResident?.branchId ?? null);

  const notedByStaffOptions: LookupOption[] = useMemo(() => {
    if (!staffFilterBranchId) return [];
    return props.staffOptions
      .filter((s) => s.branchId === staffFilterBranchId || s.branchFunction === "HQ")
      .map((s) => ({ id: s.name, label: s.name }));
  }, [props.staffOptions, staffFilterBranchId]);

  const stockStaffOptions = useMemo(() => {
    if (!staffFilterBranchId) return [];
    return props.staffOptions.filter((s) => s.branchId === staffFilterBranchId || s.branchFunction === "HQ");
  }, [props.staffOptions, staffFilterBranchId]);

  // Auto-fill stock unit from order unit (unless user manually overrode it).
  useEffect(() => {
    if (!stockUnitManuallySet) {
      setStockUnit(defaultStockUnitForOrderUnit(unit) ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit]);

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
    const matchedStaff =
      notedByVal !== OTHERS_SENTINEL
        ? props.staffOptions.find(
            (s) => s.name === notedByVal && s.branchId === staffFilterBranchId
          )
        : undefined;

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
      notedBy:
        notedByVal === OTHERS_SENTINEL
          ? notedByOther.trim()
          : matchedStaff?.staffId ?? notedByVal,
      orderedBy,
      suppliedBy,
      status: "Active",
    };
  }

  // ── Submit ───────────────────────────────────────────────────────────────────

  function doSubmitAsync(): Promise<{ success: boolean; error?: string }> {
    setError(null);
    setSuccessId(null);

    return new Promise((resolve) => {
      startTransition(async () => {
        if (isCreate) {
          const result = await createOrderAction(buildValues());
          if (!result.success) {
            setError(result.error ?? "Unknown error");
            resolve({ success: false, error: result.error ?? "Unknown error" });
            return;
          }

          // Optionally record initial stock (order must exist first)
          const stockQty = parseFloat(stockQuantity.trim() || "");
          let stockFailed = false;
          if (isFinite(stockQty) && stockQty > 0 && result.rxOrderId) {
            const stockResult = await recordStockEntryAction({
              rxOrderId: result.rxOrderId,
              entryType: "Stock Received",
              quantity: stockQty,
              unit: stockUnit,
              registeredBy: stockRegisteredBy,
              entryDate: fromDatetimeLocalValue(stockDate),
            });
            if (!stockResult.success) {
              stockFailed = true;
              setStockPartialError(stockResult.error ?? "Initial stock could not be recorded");
              console.error("[createOrderAction] Initial stock entry failed for", result.rxOrderId, ":", stockResult.error);
            }
          }

          setIsDirty(false);
          markGlobalClean();
          setSuccessId(result.rxOrderId ?? null);
          setTimeout(() => push("/residents/medication/orders"), stockFailed ? 5000 : 1800);
          resolve({ success: true });
        } else {
          const { residentId: _rid, ...rest } = buildValues();
          void _rid;
          const result = await updateOrderAction(
            (props as Extract<Props, { mode: "edit" }>).rxOrderId,
            rest
          );
          if (!result.success) {
            setError(result.error ?? "Unknown error");
            resolve({ success: false, error: result.error ?? "Unknown error" });
            return;
          }
          setIsDirty(false);
          markGlobalClean();
          setSuccessId(result.newRxOrderId ?? null);
          setTimeout(() => push("/residents/medication/orders"), 1800);
          resolve({ success: true });
        }
      });
    });
  }

  function doSubmit() {
    void doSubmitAsync();
  }

  useEffect(() => {
    doSubmitRef.current = doSubmitAsync;
  });

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
      <div className="rounded-lg border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/40 px-6 py-8 text-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="mx-auto mb-3 h-8 w-8 text-green-500 dark:text-green-400"
        >
          <path
            fillRule="evenodd"
            d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z"
            clipRule="evenodd"
          />
        </svg>
        <p className="text-sm font-semibold text-green-800 dark:text-green-300">
          {t("Order submitted successfully.")}
        </p>
        <p className="mt-1 font-mono text-xs text-green-600 dark:text-green-400">
          {t("Order ID")}: {successId}
        </p>
        {stockPartialError && (
          <p className="mt-3 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            {t("Medication order created. Initial stock could not be recorded — you can record it later from Medication > Stock.")}
          </p>
        )}
        <p className="mt-2 text-xs text-green-600 dark:text-green-400">{t("Redirecting...")}</p>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Unsaved changes modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-elevated p-6 shadow-xl">
            <h3 className="text-sm font-semibold text-fg">
              {t("Unsaved Changes")}
            </h3>
            <p className="mt-2 text-sm text-fg-subtle">
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
                  markGlobalClean();
                  setShowCancelModal(false);
                  push("/residents/medication/orders");
                }}
                className="rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium text-fg-secondary hover:bg-hover transition-colors"
              >
                {t("Exit Without Saving")}
              </button>
              <button
                onClick={() => setShowCancelModal(false)}
                className="py-1 text-sm text-fg-faint hover:text-fg-muted transition-colors"
              >
                {t("Cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="rounded-lg border border-line bg-surface shadow-sm">
          <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">

            {/* ── Resident ────────────────────────────────────────────────────── */}
            <SectionHeading title={t("Resident")} />

            {isCreate ? (
              <div className="sm:col-span-2 relative">
                <Combobox
                  label={t("Resident")}
                  showRequired
                  inputClassName={inputCls}
                  value={residentId}
                  onChange={(id) => {
                    setResidentId(id);
                    mark();
                  }}
                  options={residentOptions}
                  placeholder={t("Search by name or ID...")}
                  emptyMessage={t("No matching resident")}
                />
              </div>
            ) : (
              <div className="sm:col-span-2">
                <p className={labelCls}>{t("Resident")}</p>
                <p className="rounded-md border border-line-subtle bg-surface-muted px-3 py-2 text-sm text-fg-secondary">
                  {(props as Extract<Props, { mode: "edit" }>).residentDisplay}
                </p>
              </div>
            )}

            {/* ── Drug Information ─────────────────────────────────────────────── */}
            <SectionHeading title={t("Drug Information")} />

            {/*
              PC layout (sm:grid-cols-2):
                Left col  → Dosage Form
                Right col → Active Ingredient (top) + Brand Name (bottom, same cell)
            */}
            <Field label={t("Dosage Form")} required span2>
              <select
                value={dosageForm}
                onChange={(e) => {
                  const newForm = e.target.value;
                  setDosageForm(newForm);
                  mark();
                  if (isCreate && newForm) {
                    const defaultUnit = getDefaultUnitForDosageForm(newForm);
                    if (defaultUnit) {
                      setUnit(defaultUnit);
                    }
                  }
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

            <Field label={t("Active Ingredient")} required span2>
              <input
                type="text"
                value={activeIngredient}
                onChange={(e) => {
                  setActiveIngredient(e.target.value);
                  mark();
                }}
                placeholder={t("e.g. amlodipine 5mg")}
                className={inputCls}
              />
            </Field>

            <Field label={t("Brand Name")} span2>
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

            {/* ── Dosing ──────────────────────────────────────────────────────── */}
            <SectionHeading title={t("Dosing")} />

            {/*
              PC layout: Dose | Unit | Frequency in a 3-column row
              Mobile: stacked
            */}
            <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-4">
              <Field label={t("Dose")} required>
                <input
                  type="number"
                  value={dose}
                  onChange={(e) => {
                    setDose(e.target.value);
                    mark();
                  }}
                  placeholder="e.g. 1"
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
            </div>

            <div className="sm:col-span-2">
              <Field label={t("Administration Times")} required={adminTimesRequired}>
                <div className="mt-1">
                  <ChipSelector
                    options={TIME_SLOTS}
                    selected={adminTimes}
                    onToggle={toggleAdminTime}
                    disabled={!frequency}
                  t={t}
                  />
                  {frequency === "PRN" && (
                    <p className="mt-1.5 text-xs text-fg-faint">
                      {t("Not required for PRN frequency.")}
                    </p>
                  )}
                  {!frequency && (
                    <p className="mt-1.5 text-xs text-fg-faint">
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
                    t={t}
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
                    t={t}
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
                  t={t}
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
                  t={t}
                />
              </div>
            </Field>

            <Field label={t("Noted By")} required>
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
                required
                disabled={isCreate && !residentId}
              />
              {isCreate && !residentId && (
                <p className="mt-1 text-xs text-fg-faint">
                  {t("Select a resident first.")}
                </p>
              )}
            </Field>

            {/* ── Initial Stock Received (optional, create mode only) ──────────── */}
            {isCreate && (
              <>
                <SectionHeading title={t("Initial Stock Received (Optional)")} />

                <div className="sm:col-span-2">
                  <p className="text-xs text-fg-muted">
                    {t("If stock has already been received for this medication, you can record it now. You can also leave this blank and record stock later.")}
                  </p>
                </div>

                <Field label={t("Entry Date/Time")}>
                  <input
                    type="datetime-local"
                    value={stockDate}
                    max={toDatetimeLocalValue(new Date().toISOString())}
                    onChange={(e) => {
                      setStockDate(e.target.value);
                      mark();
                    }}
                    className={inputCls + " appearance-none"}
                  />
                </Field>

                <Field label={t("Quantity Received")}>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={stockQuantity}
                    onChange={(e) => {
                      setStockQuantity(e.target.value);
                      mark();
                    }}
                    placeholder=""
                    className={inputCls}
                  />
                  <p className="mt-1 text-xs text-fg-faint">
                    {t("Leave blank if no stock has been received yet.")}
                  </p>
                </Field>

                <Field label={t("Unit")}>
                  <select
                    value={stockUnit}
                    onChange={(e) => {
                      setStockUnit(e.target.value);
                      setStockUnitManuallySet(true);
                      mark();
                    }}
                    className={inputCls + " cursor-pointer"}
                  >
                    <option value="">{t("Select unit")}</option>
                    <optgroup label={t("Countable — balance is forecast")}>
                      {STOCK_UNITS.filter((u) => u.tracking === "Count").map((u) => (
                        <option key={u.unit} value={u.unit}>{t(u.unit)}</option>
                      ))}
                    </optgroup>
                    <optgroup label={t("Estimate — not forecast")}>
                      {STOCK_UNITS.filter((u) => u.tracking === "Estimate").map((u) => (
                        <option key={u.unit} value={u.unit}>{t(u.unit)}</option>
                      ))}
                    </optgroup>
                  </select>
                </Field>

                <Field label={t("Registered By")}>
                  <Combobox
                    hideLabel
                    label={t("Registered By")}
                    value={stockRegisteredBy}
                    onChange={(id) => {
                      setStockRegisteredBy(id);
                      mark();
                    }}
                    disabled={!staffFilterBranchId}
                    options={stockStaffOptions.map((s) => ({ id: s.staffId, label: s.name }))}
                    placeholder={t("Select staff")}
                    emptyMessage={t("No matching staff")}
                    inputClassName={inputCls}
                  />
                  {!residentId && (
                    <p className="mt-1 text-xs text-fg-faint">
                      {t("Select a resident first.")}
                    </p>
                  )}
                </Field>
              </>
            )}

            {/* ── Reference (edit only) ────────────────────────────────────────── */}
            {props.mode === "edit" && (
              <>
                <SectionHeading title={t("Reference")} />
                <div className="sm:col-span-2">
                  <p className={labelCls}>{t("Order ID")}</p>
                  <p className="font-mono text-sm text-fg-subtle">
                    {(props as Extract<Props, { mode: "edit" }>).rxOrderId}
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 border-t border-line-subtle bg-surface-muted px-5 py-4 rounded-b-lg">
            {error && (
              <p className="flex-1 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-600 dark:text-red-300">
                {error}
              </p>
            )}
            <div className="flex gap-2 ml-auto">
              <button
                type="button"
                onClick={handleCancel}
                disabled={isPending}
                className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg-muted hover:bg-hover disabled:opacity-50 transition-colors"
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
