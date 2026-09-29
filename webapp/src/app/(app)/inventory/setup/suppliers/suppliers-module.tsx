"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "@/components/language-provider";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import type { InvStaff, InvSupplier } from "@/lib/inventory/core";
import { useInvSubmit } from "../../components/use-inv-submit";
import { CARD_CLS, Field, FormStatus, INPUT_CLS, SECONDARY_BTN_CLS, StaffSelect, SubmitButton } from "../../components/form-bits";

type Props = {
  suppliers: InvSupplier[];
  staff: InvStaff[];
  canEditGlobal: boolean;
  needsStaff: boolean;
  canEditDemo: boolean;
  canCreate: boolean;
};

export function SuppliersModule({ suppliers, staff, canEditGlobal, needsStaff, canEditDemo, canCreate }: Props) {
  const t = useTranslation();
  const { guardedAction } = useSafeNavigation();
  const [selected, setSelected] = useState<number | "new" | null>(null);
  const supplier = typeof selected === "number" ? suppliers.find((s) => s.id === selected) : undefined;
  const canEdit = (s: InvSupplier | undefined) => (s === undefined ? canCreate : s.ownerBranchId === null ? canEditGlobal : canEditDemo);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="space-y-2">
        {canCreate && (
          <button type="button" className={SECONDARY_BTN_CLS} onClick={() => guardedAction(() => setSelected("new"))}>
            <Plus className="h-4 w-4" />
            {t("New supplier")}
          </button>
        )}
        <ul className="max-h-[70vh] divide-y divide-line-subtle overflow-auto rounded-lg border border-line bg-surface shadow-sm">
          {suppliers.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-hover ${selected === s.id ? "bg-selected text-selected-fg" : "text-fg"}`}
                onClick={() => guardedAction(() => setSelected(s.id))}
              >
                <span className={s.isActive ? "" : "line-through opacity-60"}>{s.name}</span>
                {s.phone && <span className="ml-2 text-xs text-fg-subtle">{s.phone}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        {selected !== null && (
          <SupplierEditor
            key={String(selected)}
            supplier={supplier}
            staff={staff}
            readOnly={!canEdit(supplier)}
            needsStaff={needsStaff && (supplier === undefined || supplier.ownerBranchId === null)}
          />
        )}
      </div>
    </div>
  );
}

function SupplierEditor({ supplier, staff, readOnly, needsStaff }: { supplier: InvSupplier | undefined; staff: InvStaff[]; readOnly: boolean; needsStaff: boolean }) {
  const t = useTranslation();
  const [f, setF] = useState({
    name: supplier?.name ?? "",
    contact: supplier?.contactPerson ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    address: supplier?.address ?? "",
    notes: supplier?.notes ?? "",
    active: supplier?.isActive ?? true,
  });
  const [staffId, setStaffId] = useState("");
  const state = useInvSubmit("inv_save_supplier", `inv-supplier-${supplier?.id ?? "new"}`);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  return (
    <form
      className={`${CARD_CLS} space-y-3`}
      onChangeCapture={state.touch}
      onSubmit={(e) => {
        e.preventDefault();
        state.submit({
          id: supplier?.id ?? null,
          name: f.name,
          contact_person: f.contact || null,
          phone: f.phone || null,
          email: f.email || null,
          address: f.address || null,
          notes: f.notes || null,
          is_active: f.active,
          performed_by_staff: needsStaff ? staffId : null,
        });
      }}
    >
      <h2 className="text-sm font-semibold text-fg">{supplier ? supplier.name : t("New supplier")}</h2>
      <fieldset disabled={readOnly} className="grid gap-3 sm:grid-cols-2">
        <Field label={t("Name")} required>
          <input className={INPUT_CLS} maxLength={120} value={f.name} onChange={set("name")} />
        </Field>
        <Field label={t("Contact person")}>
          <input className={INPUT_CLS} maxLength={120} value={f.contact} onChange={set("contact")} />
        </Field>
        <Field label={t("Phone")}>
          <input className={INPUT_CLS} maxLength={40} value={f.phone} onChange={set("phone")} />
        </Field>
        <Field label={t("Email")}>
          <input className={INPUT_CLS} maxLength={120} value={f.email} onChange={set("email")} />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t("Address")}>
            <textarea className={INPUT_CLS} rows={2} maxLength={400} value={f.address} onChange={set("address")} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label={t("Notes")}>
            <textarea className={INPUT_CLS} rows={2} maxLength={500} value={f.notes} onChange={set("notes")} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-fg-secondary">
          <input type="checkbox" checked={f.active} onChange={set("active")} />
          {t("Active")}
        </label>
        {needsStaff && <StaffSelect staff={staff} value={staffId} onChange={setStaffId} seniorOnly />}
      </fieldset>
      {readOnly ? (
        <p className="text-xs text-fg-subtle">{t("You can view this supplier but not change it.")}</p>
      ) : (
        <>
          <FormStatus state={state} />
          <SubmitButton isPending={state.isPending} label={t("Save supplier")} />
        </>
      )}
    </form>
  );
}
