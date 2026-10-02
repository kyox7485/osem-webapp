"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "@/components/language-provider";
import { OTHERS_SENTINEL } from "@/components/staff-picker-with-other";
import {
  DOSAGE_FORM_OPTIONS,
  UNIT_OPTIONS,
  FREQUENCY_OPTIONS,
  DAY_OPTIONS,
  TIME_SLOTS,
  FREQ_TIME_DEFAULTS,
  getDefaultUnitForDosageForm,
  medInputCls,
  medLabelCls,
  ToggleGroup,
  ChipSelector,
} from "@/components/medication-form-shared";
import type { OrderFormValues } from "@/app/(app)/residents/medication/orders/order-actions";
import { toDatetimeLocalValue, fromDatetimeLocalValue } from "@/lib/format-date";
import { STOCK_UNITS, defaultStockUnitForOrderUnit } from "@/lib/medication-stock";

export type MedicationDraft = Omit<OrderFormValues, "residentId"> & {
  draftId: string;
  stockEntryDate?: string;
  stockQuantity?: string;
  stockUnit?: string;
  stockRegisteredBy?: string;
};

type DraftFormValues = Omit<MedicationDraft, "draftId">;

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function FL({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className={medLabelCls}>
      {children}
      {required && <span className="ml-0.5 text-red-500"> *</span>}
    </label>
  );
}

function SH({ title }: { title: string }) {
  return (
    <h4 className="col-span-full text-xs font-semibold uppercase tracking-wide text-fg-faint mt-2 mb-0.5 border-b border-line-subtle pb-1">
      {title}
    </h4>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

type ModalProps = {
  open: boolean;
  onClose: () => void;
  onSave: (values: DraftFormValues) => void;
  initialValues: DraftFormValues | null;
  admissionDate: string;
  masterStaff: string;
  masterStaffOther: string;
};

function MedicationDraftModal({
  open, onClose, onSave, initialValues, admissionDate,
  masterStaff, masterStaffOther,
}: ModalProps) {
  const t = useTranslation();
  const defaultDate = admissionDate || new Date().toISOString().split("T")[0];

  const [dosageForm, setDosageForm] = useState("");
  const [dosageFormOther, setDosageFormOther] = useState("");
  const [brandName, setBrandName] = useState("");
  const [activeIngredient, setActiveIngredient] = useState("");
  const [dose, setDose] = useState("");
  const [unit, setUnit] = useState("");
  const [frequency, setFrequency] = useState("");
  const [adminTimes, setAdminTimes] = useState<string[]>([]);
  const [dosingDays, setDosingDays] = useState<string[]>(["Everyday"]);
  const [indication, setIndication] = useState("");
  const [instruction, setInstruction] = useState("");
  const [durationType, setDurationType] = useState("");
  const [startDate, setStartDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState("");
  const [orderedBy, setOrderedBy] = useState("");
  const [suppliedBy, setSuppliedBy] = useState("");
  const [notedByVal, setNotedByVal] = useState("");
  const [notedByOther, setNotedByOther] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // ── Initial Stock Received (optional) ────────────────────────────────────────
  const [stockDate, setStockDate] = useState(() => toDatetimeLocalValue(new Date().toISOString()));
  const [stockQuantity, setStockQuantity] = useState("");
  const [stockUnit, setStockUnit] = useState("");
  const [stockUnitManuallySet, setStockUnitManuallySet] = useState(false);
  const [stockRegisteredBy, setStockRegisteredBy] = useState("");

  // Reset when modal opens (false→true transition)
  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (initialValues) {
      const isOtherDosage =
        !!initialValues.dosageForm && !DOSAGE_FORM_OPTIONS.includes(initialValues.dosageForm);
      setDosageForm(isOtherDosage ? "Others" : (initialValues.dosageForm || ""));
      setDosageFormOther(isOtherDosage ? initialValues.dosageForm : "");
      setBrandName(initialValues.brandName || "");
      setActiveIngredient(initialValues.activeIngredient || "");
      setDose(initialValues.dose || "");
      setUnit(initialValues.unit || "");
      setFrequency(initialValues.frequency || "");
      setAdminTimes(
        initialValues.administrationTimes
          ? initialValues.administrationTimes.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
      );
      const days = initialValues.dosingDays
        ? initialValues.dosingDays.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      setDosingDays(days.length > 0 ? days : ["Everyday"]);
      setIndication(initialValues.indication || "");
      setInstruction(initialValues.instruction || "");
      setDurationType(initialValues.durationType || "");
      setStartDate(initialValues.startDate || defaultDate);
      setEndDate(initialValues.endDate || "");
      setOrderedBy(initialValues.orderedBy || "");
      setSuppliedBy(initialValues.suppliedBy || "");
      // Always use master staff from the registration form
      setNotedByVal(masterStaff); setNotedByOther(masterStaffOther);
      // Stock fields
      setStockDate(
        initialValues.stockEntryDate
          ? toDatetimeLocalValue(initialValues.stockEntryDate)
          : toDatetimeLocalValue(new Date().toISOString()),
      );
      setStockQuantity(initialValues.stockQuantity || "");
      setStockUnit(initialValues.stockUnit || (defaultStockUnitForOrderUnit(initialValues.unit) ?? ""));
      setStockUnitManuallySet(!!initialValues.stockUnit);
      setStockRegisteredBy(masterStaff !== OTHERS_SENTINEL ? masterStaff : (initialValues.stockRegisteredBy || ""));
    } else {
      setDosageForm(""); setDosageFormOther(""); setBrandName(""); setActiveIngredient("");
      setDose(""); setUnit(""); setFrequency(""); setAdminTimes([]); setDosingDays(["Everyday"]);
      setIndication(""); setInstruction(""); setDurationType("");
      setStartDate(defaultDate); setEndDate("");
      setOrderedBy(""); setSuppliedBy("");
      setNotedByVal(masterStaff); setNotedByOther(masterStaffOther);
      // Stock fields
      setStockDate(toDatetimeLocalValue(new Date().toISOString()));
      setStockQuantity(""); setStockUnit(""); setStockUnitManuallySet(false);
      // Only set stock registered-by from master if it's a real staff ID (not free-text)
      setStockRegisteredBy(masterStaff !== OTHERS_SENTINEL ? masterStaff : "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleFrequencyChange(newFreq: string) {
    setFrequency(newFreq);
    if (FREQ_TIME_DEFAULTS[newFreq]) {
      setAdminTimes(FREQ_TIME_DEFAULTS[newFreq]);
    } else if (newFreq === "PRN") {
      setAdminTimes([]);
    }
  }

  function toggleAdminTime(time: string) {
    setAdminTimes((prev) =>
      prev.includes(time) ? prev.filter((t) => t !== time) : [...prev, time],
    );
  }

  function toggleDosingDay(day: string) {
    setDosingDays((prev) => {
      if (day === "Everyday") return ["Everyday"];
      const without = prev.filter((d) => d !== "Everyday");
      return without.includes(day) ? without.filter((d) => d !== day) : [...without, day];
    });
  }

  function buildValues(): DraftFormValues {
    const hasStock = stockQuantity.trim() !== "";
    return {
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
      stockEntryDate: hasStock ? fromDatetimeLocalValue(stockDate) : undefined,
      stockQuantity: hasStock ? stockQuantity.trim() : undefined,
      stockUnit: hasStock ? stockUnit : undefined,
      stockRegisteredBy: hasStock ? stockRegisteredBy : undefined,
    };
  }

  function handleSave() {
    const vals = buildValues();
    const missing: string[] = [];
    if (!vals.dosageForm) missing.push(t("Dosage Form"));
    if (!vals.activeIngredient) missing.push(t("Active Ingredient"));
    if (!vals.dose) missing.push(t("Dose"));
    if (!vals.unit) missing.push(t("Unit"));
    if (!vals.frequency) missing.push(t("Frequency"));
    if (vals.frequency !== "PRN" && adminTimes.length === 0) missing.push(t("Administration Times"));
    if (!vals.durationType) missing.push(t("Duration Type"));
    if (!vals.orderedBy) missing.push(t("Ordered By"));
    if (!vals.suppliedBy) missing.push(t("Supplied By"));
    if (missing.length > 0) {
      setFormError(`${t("Required")}: ${missing.join(", ")}`);
      return;
    }
    // Stock field validation (only when a quantity is entered)
    if (stockQuantity.trim() !== "") {
      const qty = parseFloat(stockQuantity);
      if (isNaN(qty) || qty <= 0) {
        setFormError(t("Stock quantity must be more than 0"));
        return;
      }
      if (!stockUnit) {
        setFormError(t("Stock unit is required when a quantity is entered"));
        return;
      }
      if (!stockRegisteredBy) {
        setFormError(t("Registered By is required for stock entry"));
        return;
      }
    }
    setFormError(null);
    onSave(vals);
  }

  const showDosingDays = frequency === "Selected Days" || frequency === "Others";
  const showEndDate = durationType === "Short Term";
  const adminTimesRequired = !!frequency && frequency !== "PRN";

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full sm:max-w-2xl bg-elevated border border-line rounded-t-2xl sm:rounded-xl shadow-xl flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line flex-shrink-0">
          <h3 className="text-base font-semibold text-fg">
            {initialValues ? t("Edit Medication / Supplement") : t("Add Medication / Supplement")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Close")}
            className="rounded-lg p-1.5 text-fg-muted hover:bg-hover transition-colors"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">

            <SH title={t("Drug Information")} />

            <div className="sm:col-span-2">
              <FL required>{t("Dosage Form")}</FL>
              <select
                value={dosageForm}
                onChange={(e) => {
                  const v = e.target.value;
                  setDosageForm(v);
                  if (v && v !== "Others") {
                    const u = getDefaultUnitForDosageForm(v);
                    if (u) setUnit(u);
                  }
                }}
                className={medInputCls + " cursor-pointer"}
              >
                <option value="">{t("Select dosage form")}</option>
                {DOSAGE_FORM_OPTIONS.map((o) => (
                  <option key={o} value={o}>{t(o)}</option>
                ))}
                <option value="Others">{t("Others (please specify)")}</option>
              </select>
              {dosageForm === "Others" && (
                <input
                  type="text"
                  value={dosageFormOther}
                  onChange={(e) => setDosageFormOther(e.target.value)}
                  placeholder={t("Please specify...")}
                  className={medInputCls + " mt-2"}
                />
              )}
            </div>

            <div className="sm:col-span-2">
              <FL required>{t("Active Ingredient")}</FL>
              <input
                type="text"
                value={activeIngredient}
                onChange={(e) => setActiveIngredient(e.target.value)}
                placeholder={t("e.g. amlodipine 5mg")}
                className={medInputCls}
              />
            </div>

            <div className="sm:col-span-2">
              <FL>{t("Brand Name")}</FL>
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder={t("Optional")}
                className={medInputCls}
              />
            </div>

            <SH title={t("Dosing")} />

            <div>
              <FL required>{t("Dose")}</FL>
              <input
                type="number"
                value={dose}
                onChange={(e) => setDose(e.target.value)}
                placeholder="e.g. 1"
                min="0.01"
                step="0.01"
                className={medInputCls}
              />
            </div>

            <div>
              <FL required>{t("Unit")}</FL>
              <select
                value={unit}
                onChange={(e) => {
                  const newUnit = e.target.value;
                  setUnit(newUnit);
                  if (!stockUnitManuallySet) {
                    setStockUnit(defaultStockUnitForOrderUnit(newUnit) ?? "");
                  }
                }}
                className={medInputCls + " cursor-pointer"}
              >
                <option value="">{t("Select unit")}</option>
                {UNIT_OPTIONS.map((o) => (
                  <option key={o} value={o}>{t(o)}</option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <FL required>{t("Frequency")}</FL>
              <select
                value={frequency}
                onChange={(e) => handleFrequencyChange(e.target.value)}
                className={medInputCls + " cursor-pointer"}
              >
                <option value="">{t("Select frequency")}</option>
                {FREQUENCY_OPTIONS.map((o) => (
                  <option key={o} value={o}>{t(o)}</option>
                ))}
              </select>
            </div>

            {showDosingDays && (
              <div className="sm:col-span-2">
                <FL required>{t("Dosing Days")}</FL>
                <div className="mt-1">
                  <ChipSelector options={DAY_OPTIONS} selected={dosingDays} onToggle={toggleDosingDay} t={t} />
                </div>
              </div>
            )}

            <div className="sm:col-span-2">
              <FL required={adminTimesRequired}>{t("Administration Times")}</FL>
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
            </div>

            <SH title={t("Clinical")} />

            <div>
              <FL>{t("Indication")}</FL>
              <input
                type="text"
                value={indication}
                onChange={(e) => setIndication(e.target.value)}
                placeholder={t("e.g. Hypertension")}
                className={medInputCls}
              />
            </div>

            <div>
              <FL>{t("Instruction")}</FL>
              <input
                type="text"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder={t("e.g. Take after meal")}
                className={medInputCls}
              />
            </div>

            <SH title={t("Duration & Dates")} />

            <div className="sm:col-span-2">
              <FL required>{t("Duration Type")}</FL>
              <div className="mt-1">
                <ToggleGroup
                  options={["Long Term", "Short Term"]}
                  value={durationType}
                  onChange={setDurationType}
                  t={t}
                />
              </div>
            </div>

            <div>
              <FL required>{t("Start Date")}</FL>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={medInputCls}
              />
            </div>

            {showEndDate && (
              <div>
                <FL required>{t("End Date")}</FL>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate || undefined}
                  className={medInputCls}
                />
              </div>
            )}

            <SH title={t("Personnel")} />

            <div>
              <FL required>{t("Ordered By")}</FL>
              <div className="mt-1">
                <ToggleGroup
                  options={["OSEM Medical Team", "Family"]}
                  value={orderedBy}
                  onChange={setOrderedBy}
                  t={t}
                />
              </div>
            </div>

            <div>
              <FL required>{t("Supplied By")}</FL>
              <div className="mt-1">
                <ToggleGroup
                  options={["OSEM", "Family"]}
                  value={suppliedBy}
                  onChange={setSuppliedBy}
                  t={t}
                />
              </div>
            </div>

            <SH title={t("Initial Stock Received (Optional)")} />

            <div className="sm:col-span-2">
              <p className="text-xs text-fg-muted">
                {t("If stock has already been received for this medication, you can record it now. You can also leave this blank and record stock later.")}
              </p>
            </div>

            {/* Entry Date/Time */}
            <div>
              <FL>{t("Entry Date/Time")}</FL>
              <input
                type="datetime-local"
                value={stockDate}
                max={toDatetimeLocalValue(new Date().toISOString())}
                onChange={(e) => setStockDate(e.target.value)}
                className={medInputCls + " appearance-none"}
              />
            </div>

            {/* Quantity Received */}
            <div>
              <FL>{t("Quantity Received")}</FL>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={stockQuantity}
                onChange={(e) => setStockQuantity(e.target.value)}
                placeholder=""
                className={medInputCls}
              />
              <p className="mt-1 text-xs text-fg-faint">
                {t("Leave blank if no stock has been received yet.")}
              </p>
            </div>

            {/* Stock Unit */}
            <div>
              <FL>{t("Unit")}</FL>
              <select
                value={stockUnit}
                onChange={(e) => {
                  setStockUnit(e.target.value);
                  setStockUnitManuallySet(true);
                }}
                className={medInputCls + " cursor-pointer"}
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
            </div>

          </div>
        </div>

        {/* Error bar */}
        {formError && (
          <div className="px-5 py-2 bg-red-50 dark:bg-red-950/30 border-t border-red-200 dark:border-red-900 flex-shrink-0">
            <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-line flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-fg-muted border border-line-strong hover:bg-hover transition-colors"
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-lg px-4 py-2 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-sm"
          >
            {initialValues ? t("Update") : t("Add")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

type SectionProps = {
  drafts: MedicationDraft[];
  onDraftsChange: (drafts: MedicationDraft[]) => void;
  branchId: string;
  admissionDate: string;
  masterStaff: string;
  masterStaffOther: string;
};

export function AdmissionMedicationsSection({
  drafts,
  onDraftsChange,
  branchId,
  admissionDate,
  masterStaff,
  masterStaffOther,
}: SectionProps) {
  const t = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDraft, setEditingDraft] = useState<MedicationDraft | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  function openAdd() {
    setEditingDraft(null);
    setEditingIndex(null);
    setModalOpen(true);
  }

  function openEdit(draft: MedicationDraft, index: number) {
    setEditingDraft(draft);
    setEditingIndex(index);
    setModalOpen(true);
  }

  function handleDelete(index: number) {
    onDraftsChange(drafts.filter((_, i) => i !== index));
  }

  function handleSave(values: DraftFormValues) {
    if (editingIndex !== null && editingDraft !== null) {
      onDraftsChange(
        drafts.map((d, i) =>
          i === editingIndex ? { ...values, draftId: editingDraft.draftId } : d,
        ),
      );
    } else {
      onDraftsChange([
        ...drafts,
        { ...values, draftId: `draft-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      ]);
    }
    setModalOpen(false);
  }

  function getMedLabel(draft: MedicationDraft) {
    const brand = draft.brandName.trim();
    const active = draft.activeIngredient.trim();
    if (brand && active) return `${brand} (${active})`;
    return brand || active || "–";
  }

  const modalInitialValues: DraftFormValues | null = editingDraft
    ? (({ draftId: _id, ...rest }) => rest)(editingDraft)
    : null;

  return (
    <>
      <div className="sm:col-span-2 md:col-span-3">
        <div className="rounded-xl border border-line bg-surface overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-line bg-elevated">
            <h3 className="text-sm font-semibold text-fg">
              {t("Current Medications / Supplements")}
              {drafts.length > 0 && (
                <span className="ml-2 inline-flex items-center rounded-full bg-indigo-100 dark:bg-indigo-950/50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                  {drafts.length}
                </span>
              )}
            </h3>
            <button
              type="button"
              onClick={openAdd}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 transition-colors shadow-sm"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
              </svg>
              {t("Add Medication / Supplement")}
            </button>
          </div>

          {drafts.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
              <svg
                className="h-10 w-10 text-fg-faint mb-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"
                />
              </svg>
              <p className="text-sm text-fg-muted mb-3">
                {t("No current medications or supplements added.")}
              </p>
              <button
                type="button"
                onClick={openAdd}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors shadow-sm"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                </svg>
                {t("Add Medication / Supplement")}
              </button>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-muted text-xs text-fg-muted">
                      <th className="text-left px-4 py-2.5 font-medium">{t("Medication / Supplement")}</th>
                      <th className="text-left px-4 py-2.5 font-medium">{t("Dose")}</th>
                      <th className="text-left px-4 py-2.5 font-medium">{t("Unit")}</th>
                      <th className="text-left px-4 py-2.5 font-medium">{t("Frequency")}</th>
                      <th className="text-left px-4 py-2.5 font-medium">{t("Dosing Day")}</th>
                      <th className="text-left px-4 py-2.5 font-medium">{t("Duration")}</th>
                      <th className="text-left px-4 py-2.5 font-medium">{t("Stock Received")}</th>
                      <th className="text-left px-4 py-2.5 font-medium">{t("Actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-subtle">
                    {drafts.map((draft, i) => (
                      <tr key={draft.draftId} className="hover:bg-hover/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-fg max-w-[200px]">
                          <span className="line-clamp-2">{getMedLabel(draft)}</span>
                        </td>
                        <td className="px-4 py-3 text-fg-secondary whitespace-nowrap">
                          {draft.dose || "–"}
                        </td>
                        <td className="px-4 py-3 text-fg-secondary whitespace-nowrap">
                          {draft.unit || "–"}
                        </td>
                        <td className="px-4 py-3 text-fg-secondary whitespace-nowrap">
                          {draft.frequency || "–"}
                        </td>
                        <td className="px-4 py-3 text-fg-secondary text-xs max-w-[120px]">
                          <span className="line-clamp-2">{draft.dosingDays || "–"}</span>
                        </td>
                        <td className="px-4 py-3 text-fg-secondary whitespace-nowrap">
                          {draft.durationType || "–"}
                        </td>
                        <td className="px-4 py-3 text-fg-secondary whitespace-nowrap">
                          {draft.stockQuantity
                            ? `${draft.stockQuantity} ${draft.stockUnit || ""}`.trim()
                            : "—"}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => openEdit(draft, i)}
                              className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors"
                            >
                              {t("Edit")}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(i)}
                              className="text-xs font-medium text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                            >
                              {t("Delete")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="sm:hidden divide-y divide-line-subtle">
                {drafts.map((draft, i) => (
                  <div key={draft.draftId} className="px-4 py-3 space-y-1">
                    <p className="font-medium text-sm text-fg">{getMedLabel(draft)}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-fg-muted">
                      {draft.dose && <span>{draft.dose} {draft.unit}</span>}
                      {draft.frequency && <span>{draft.frequency}</span>}
                      {draft.dosingDays && <span>{draft.dosingDays}</span>}
                      {draft.durationType && <span>{draft.durationType}</span>}
                      {draft.stockQuantity && (
                        <span className="text-indigo-600 dark:text-indigo-400">
                          {t("Stock received")}: {draft.stockQuantity} {draft.stockUnit}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 pt-0.5">
                      <button
                        type="button"
                        onClick={() => openEdit(draft, i)}
                        className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 transition-colors"
                      >
                        {t("Edit")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(i)}
                        className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors"
                      >
                        {t("Delete")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <MedicationDraftModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        initialValues={modalInitialValues}
        admissionDate={admissionDate}
        masterStaff={masterStaff}
        masterStaffOther={masterStaffOther}
      />
    </>
  );
}
