"use client";

import { useState, useTransition, useMemo, useRef } from "react";
import { useNavPush } from "@/components/nav-loading";
import { useTranslation } from "@/components/language-provider";
import { createOrderAction, updateOrderAction, type OrderFormValues } from "./order-actions";

type ResidentOption = {
  id: number;
  name: string;
  residentTextId: string; // tbl_residents.ResidentID text value
};

type Props =
  | {
      mode: "create";
      residents: ResidentOption[];
    }
  | {
      mode: "edit";
      rxOrderId: string;
      residentDisplay: string; // e.g. "BMN-0002 – John Doe"
      initialValues: Omit<OrderFormValues, "residentId">;
    };

const STATUS_OPTIONS = ["Active", "Discontinued", "Completed", "On Hold"];
const NO_RESIDENTS: ResidentOption[] = [];

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

const labelCls = "block text-xs font-medium text-gray-600 mb-1";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
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

export function OrderForm(props: Props) {
  const t = useTranslation();
  const push = useNavPush();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

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

  // Resident combobox (create mode only)
  const [residentId, setResidentId] = useState("");
  const [residentSearch, setResidentSearch] = useState("");
  const [residentDropOpen, setResidentDropOpen] = useState(false);
  const residentInputRef = useRef<HTMLInputElement>(null);

  // Form fields
  const [dosageForm, setDosageForm] = useState(init.dosageForm);
  const [brandName, setBrandName] = useState(init.brandName);
  const [activeIngredient, setActiveIngredient] = useState(init.activeIngredient);
  const [dose, setDose] = useState(init.dose);
  const [unit, setUnit] = useState(init.unit);
  const [frequency, setFrequency] = useState(init.frequency);
  const [administrationTimes, setAdministrationTimes] = useState(init.administrationTimes);
  const [dosingDays, setDosingDays] = useState(init.dosingDays);
  const [indication, setIndication] = useState(init.indication);
  const [instruction, setInstruction] = useState(init.instruction);
  const [durationType, setDurationType] = useState(init.durationType);
  const [startDate, setStartDate] = useState(init.startDate);
  const [endDate, setEndDate] = useState(init.endDate);
  const [notedBy, setNotedBy] = useState(init.notedBy);
  const [orderedBy, setOrderedBy] = useState(init.orderedBy);
  const [suppliedBy, setSuppliedBy] = useState(init.suppliedBy);
  const [status, setStatus] = useState(init.status || "Active");
  const [previousRxOrderId, setPreviousRxOrderId] = useState(init.previousRxOrderId);

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

  function buildValues(): OrderFormValues {
    return {
      residentId,
      dosageForm,
      brandName,
      activeIngredient,
      dose,
      unit,
      frequency,
      administrationTimes,
      dosingDays,
      indication,
      instruction,
      durationType,
      startDate,
      endDate,
      notedBy,
      orderedBy,
      suppliedBy,
      status,
      previousRxOrderId,
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessId(null);

    startTransition(async () => {
      if (isCreate) {
        const result = await createOrderAction(buildValues());
        if (!result.success) {
          setError(result.error ?? "Unknown error");
          return;
        }
        setSuccessId(result.rxOrderId ?? null);
        // Navigate to orders list after a short display of the new ID
        setTimeout(() => push("/residents/medication/orders"), 1800);
      } else {
        const { residentId: _rid, ...rest } = buildValues();
        void _rid;
        const result = await updateOrderAction(props.rxOrderId, rest);
        if (!result.success) {
          setError(result.error ?? "Unknown error");
          return;
        }
        push("/residents/medication/orders");
      }
    });
  }

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
        <p className="text-sm font-semibold text-green-800">{t("Order submitted successfully.")}</p>
        <p className="mt-1 font-mono text-xs text-green-600">{t("Order ID")}: {successId}</p>
        <p className="mt-2 text-xs text-green-600">{t("Redirecting...")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">

          {/* ── Resident ───────────────────────────────────────────────────── */}
          <SectionHeading title={t("Resident")} />

          {isCreate ? (
            <div className="sm:col-span-2 relative">
              <Field label={t("Resident")} required>
                <div className="relative">
                  <input
                    ref={residentInputRef}
                    type="text"
                    value={selectedResident ? `${selectedResident.residentTextId} – ${selectedResident.name}` : residentSearch}
                    onChange={(e) => {
                      if (selectedResident) {
                        // Clear selection when user starts typing again
                        setResidentId("");
                      }
                      setResidentSearch(e.target.value);
                      setResidentDropOpen(true);
                    }}
                    onFocus={() => setResidentDropOpen(true)}
                    onBlur={() => setTimeout(() => setResidentDropOpen(false), 150)}
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
                          }}
                          className="cursor-pointer px-3 py-2 hover:bg-indigo-50"
                        >
                          <span className="font-medium text-gray-900">{r.name}</span>
                          <span className="ml-2 text-xs text-gray-400">{r.residentTextId}</span>
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

          {/* ── Drug info ──────────────────────────────────────────────────── */}
          <SectionHeading title={t("Drug Information")} />

          <div className="sm:col-span-2">
            <Field label={t("Active Ingredient")} required>
              <input
                type="text"
                value={activeIngredient}
                onChange={(e) => setActiveIngredient(e.target.value)}
                placeholder={t("e.g. atorvastatin 40mg")}
                className={inputCls}
              />
            </Field>
          </div>

          <Field label={t("Brand Name")}>
            <input
              type="text"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder={t("Optional")}
              className={inputCls}
            />
          </Field>

          <Field label={t("Dosage Form")}>
            <input
              type="text"
              value={dosageForm}
              onChange={(e) => setDosageForm(e.target.value)}
              placeholder={t("e.g. Tablet, Syrup, Cream")}
              className={inputCls}
            />
          </Field>

          {/* ── Dosing ─────────────────────────────────────────────────────── */}
          <SectionHeading title={t("Dosing")} />

          <Field label={t("Dose")}>
            <input
              type="text"
              value={dose}
              onChange={(e) => setDose(e.target.value)}
              placeholder={t("e.g. 10, 2.5, 100/45")}
              className={inputCls}
            />
          </Field>

          <Field label={t("Unit")}>
            <input
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder={t("e.g. mg, ml, mcg")}
              className={inputCls}
            />
          </Field>

          <Field label={t("Frequency")}>
            <input
              type="text"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              placeholder={t("e.g. OD, BD, TDS, PRN")}
              className={inputCls}
            />
          </Field>

          <Field label={t("Administration Times")}>
            <input
              type="text"
              value={administrationTimes}
              onChange={(e) => setAdministrationTimes(e.target.value)}
              placeholder={t("e.g. 8am, 8am/8pm")}
              className={inputCls}
            />
          </Field>

          <Field label={t("Dosing Days")}>
            <input
              type="text"
              value={dosingDays}
              onChange={(e) => setDosingDays(e.target.value)}
              placeholder={t("e.g. Daily, Mon/Wed/Fri")}
              className={inputCls}
            />
          </Field>

          {/* ── Clinical ───────────────────────────────────────────────────── */}
          <SectionHeading title={t("Clinical")} />

          <Field label={t("Indication")}>
            <input
              type="text"
              value={indication}
              onChange={(e) => setIndication(e.target.value)}
              placeholder={t("e.g. Hypertension")}
              className={inputCls}
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label={t("Instruction")}>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={2}
                placeholder={t("e.g. Take after meal")}
                className={inputCls}
              />
            </Field>
          </div>

          {/* ── Duration & Dates ────────────────────────────────────────────── */}
          <SectionHeading title={t("Duration & Dates")} />

          <Field label={t("Duration Type")}>
            <input
              type="text"
              value={durationType}
              onChange={(e) => setDurationType(e.target.value)}
              placeholder={t("e.g. Chronic, Acute, Short Course")}
              className={inputCls}
            />
          </Field>

          <div />

          <Field label={t("Start Date")} required>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputCls}
            />
          </Field>

          <Field label={t("End Date")}>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate || undefined}
              className={inputCls}
            />
          </Field>

          {/* ── Personnel ──────────────────────────────────────────────────── */}
          <SectionHeading title={t("Personnel")} />

          <Field label={t("Ordered By")} required>
            <input
              type="text"
              value={orderedBy}
              onChange={(e) => setOrderedBy(e.target.value)}
              placeholder={t("Doctor / prescriber name")}
              className={inputCls}
            />
          </Field>

          <Field label={t("Noted By")}>
            <input
              type="text"
              value={notedBy}
              onChange={(e) => setNotedBy(e.target.value)}
              placeholder={t("Nurse / staff who noted the order")}
              className={inputCls}
            />
          </Field>

          <Field label={t("Supplied By")}>
            <input
              type="text"
              value={suppliedBy}
              onChange={(e) => setSuppliedBy(e.target.value)}
              placeholder={t("Pharmacy / supplier")}
              className={inputCls}
            />
          </Field>

          {/* ── Admin ──────────────────────────────────────────────────────── */}
          <SectionHeading title={t("Order Status")} />

          <Field label={t("Status")}>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={inputCls}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {t(s)}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("Previous Order ID")}>
            <input
              type="text"
              value={previousRxOrderId}
              onChange={(e) => setPreviousRxOrderId(e.target.value)}
              placeholder={t("If this order supersedes an earlier one")}
              className={`${inputCls} font-mono`}
            />
          </Field>

          {props.mode === "edit" && (
            <>
              <SectionHeading title={t("Reference")} />
              <div className="sm:col-span-2">
                <p className={labelCls}>{t("Order ID")}</p>
                <p className="font-mono text-sm text-gray-500">{props.rxOrderId}</p>
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
              onClick={() => push("/residents/medication/orders")}
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
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
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
  );
}
