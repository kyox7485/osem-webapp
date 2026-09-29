"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "@/components/language-provider";
import { parseMoney, type InvProduct } from "@/lib/inventory/core";
import { useInvSubmit } from "../../components/use-inv-submit";
import { CARD_CLS, Field, FormStatus, INPUT_CLS, SECONDARY_BTN_CLS, SMALL_INPUT_CLS, SubmitButton } from "../../components/form-bits";
import type { ProductsModuleProps } from "./products-module";

type ConvRow = { key: string; uomId: string; factor: string };
type Form = {
  sku: string;
  name: string;
  description: string;
  categoryId: string;
  baseUomId: string;
  purchaseUomId: string;
  supplierId: string;
  stdCost: string;
  chargeable: boolean;
  price: string;
  maxStore: string;
  maxFloor: string;
  active: boolean;
};

const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

function initialForm(p: InvProduct | undefined): Form {
  return {
    sku: p?.sku ?? "",
    name: p?.name ?? "",
    description: p?.description ?? "",
    categoryId: str(p?.categoryId),
    baseUomId: str(p?.baseUomId),
    purchaseUomId: str(p?.purchaseUomId),
    supplierId: str(p?.defaultSupplierId),
    stdCost: str(p?.standardUnitCost),
    chargeable: p?.isChargeable ?? true,
    price: str(p?.chargePrice),
    maxStore: str(p?.defaultMaxStore),
    maxFloor: str(p?.defaultMaxFloor),
    active: p?.isActive ?? true,
  };
}

/**
 * Create / edit a product and its unit conversions (D-106): the base unit is
 * the smallest issuable unit (factor 1); every other unit says how many base
 * units it holds. A conversion that has been used cannot change (the RPC
 * answers UOM_FACTOR_LOCKED) — add a new unit instead.
 */
export function ProductEditor({
  product,
  readOnly,
  catalogue,
  categories,
  suppliers,
}: ProductsModuleProps & { product: InvProduct | undefined; readOnly: boolean }) {
  const t = useTranslation();
  const [f, setF] = useState<Form>(() => initialForm(product));
  const [convs, setConvs] = useState<ConvRow[]>(() =>
    (product?.uoms ?? [])
      .filter((u) => u.isActive && u.uomId !== product?.baseUomId)
      .map((u) => ({ key: `c${u.uomId}`, uomId: String(u.uomId), factor: String(u.factor) }))
  );
  const state = useInvSubmit("inv_save_product", `inv-product-${product?.id ?? "new"}`);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  const isService = categories.find((c) => String(c.id) === f.categoryId)?.isService ?? false;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nums = [f.stdCost, f.price, f.maxStore, f.maxFloor].map((v) => parseMoney(v));
    if (nums.some((n) => n === undefined)) return state.setError("INVALID_NUMBER");
    const uoms = [];
    for (const c of convs) {
      if (!c.uomId) continue;
      const factor = Number(c.factor);
      if (!Number.isFinite(factor) || factor <= 1) return state.setError("UOM_FACTOR_INVALID");
      uoms.push({ uom_id: Number(c.uomId), factor_to_base: factor });
    }
    state.submit({
      id: product?.id ?? null,
      sku: f.sku.trim(),
      name: f.name,
      description: f.description || null,
      category_id: f.categoryId ? Number(f.categoryId) : null,
      base_uom_id: f.baseUomId ? Number(f.baseUomId) : null,
      purchase_uom_id: f.purchaseUomId ? Number(f.purchaseUomId) : null,
      default_supplier_id: f.supplierId ? Number(f.supplierId) : null,
      standard_unit_cost: nums[0],
      is_chargeable: f.chargeable,
      charge_price: nums[1],
      default_max_store: isService ? null : nums[2],
      default_max_floor: isService ? null : nums[3],
      is_active: f.active,
      uoms,
    });
  }

  const uomOptions = catalogue.uoms.map((u) => (
    <option key={u.id} value={u.id}>
      {u.code} — {u.name}
    </option>
  ));

  return (
    <form className={`${CARD_CLS} space-y-3`} onChangeCapture={state.touch} onSubmit={handleSubmit}>
      <h2 className="text-sm font-semibold text-fg">
        {product ? product.name : t("New product")}
        {product?.ownerBranchId !== null && product && <span className="ml-2 text-xs font-normal text-fg-subtle">{t("Demo-only product")}</span>}
      </h2>
      <fieldset disabled={readOnly} className="grid gap-3 sm:grid-cols-2">
        <Field label={t("SKU")} required>
          <input className={INPUT_CLS} maxLength={40} value={f.sku} onChange={set("sku")} />
        </Field>
        <Field label={t("Name")} required>
          <input className={INPUT_CLS} maxLength={160} value={f.name} onChange={set("name")} />
        </Field>
        <Field label={t("Category")} required>
          <select className={INPUT_CLS} value={f.categoryId} onChange={set("categoryId")}>
            <option value="">{t("Select category")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Default supplier")}>
          <select className={INPUT_CLS} value={f.supplierId} onChange={set("supplierId")}>
            <option value="">{t("None")}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Base unit (smallest issued)")} required>
          <select className={INPUT_CLS} value={f.baseUomId} onChange={set("baseUomId")}>
            <option value="">{t("Select unit")}</option>
            {uomOptions}
          </select>
        </Field>
        <Field label={t("Purchase unit")} required>
          <select className={INPUT_CLS} value={f.purchaseUomId} onChange={set("purchaseUomId")}>
            <option value="">{t("Select unit")}</option>
            {uomOptions}
          </select>
        </Field>
        <Field label={t("Charge price per base unit (RM)")} hint={t("Empty = price pending")}>
          <input className={INPUT_CLS} inputMode="decimal" value={f.price} onChange={set("price")} />
        </Field>
        <Field label={t("Standard cost per base unit (RM)")} hint={t("Used only when there is no average cost yet")}>
          <input className={INPUT_CLS} inputMode="decimal" value={f.stdCost} onChange={set("stdCost")} />
        </Field>
        {!isService && (
          <>
            <Field label={t("Default max (Store)")}>
              <input className={INPUT_CLS} inputMode="decimal" value={f.maxStore} onChange={set("maxStore")} />
            </Field>
            <Field label={t("Default max (Floor)")}>
              <input className={INPUT_CLS} inputMode="decimal" value={f.maxFloor} onChange={set("maxFloor")} />
            </Field>
          </>
        )}
        <label className="flex items-center gap-2 text-sm text-fg-secondary">
          <input type="checkbox" checked={f.chargeable} onChange={set("chargeable")} />
          {t("Chargeable to residents")}
        </label>
        <label className="flex items-center gap-2 text-sm text-fg-secondary">
          <input type="checkbox" checked={f.active} onChange={set("active")} />
          {t("Active")}
        </label>
        <div className="sm:col-span-2">
          <Field label={t("Description")}>
            <textarea className={INPUT_CLS} rows={2} maxLength={1000} value={f.description} onChange={set("description")} />
          </Field>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <p className="text-sm font-medium text-fg-secondary">{t("Other units (how many base units each holds)")}</p>
          {convs.map((c) => (
            <div key={c.key} className="flex items-center gap-2">
              <select
                className={SMALL_INPUT_CLS}
                value={c.uomId}
                onChange={(e) => setConvs(convs.map((x) => (x.key === c.key ? { ...x, uomId: e.target.value } : x)))}
              >
                <option value="">{t("Select unit")}</option>
                {uomOptions}
              </select>
              <input
                className={`${SMALL_INPUT_CLS} w-28`}
                inputMode="decimal"
                value={c.factor}
                onChange={(e) => setConvs(convs.map((x) => (x.key === c.key ? { ...x, factor: e.target.value } : x)))}
                aria-label={t("Base units per unit")}
              />
              <button
                type="button"
                className="rounded p-1 text-fg-faint hover:bg-hover hover:text-red-600"
                onClick={() => {
                  state.touch();
                  setConvs(convs.filter((x) => x.key !== c.key));
                }}
                aria-label={t("Remove line")}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className={SECONDARY_BTN_CLS}
            onClick={() => {
              state.touch();
              setConvs([...convs, { key: `n${Date.now()}`, uomId: "", factor: "" }]);
            }}
          >
            <Plus className="h-4 w-4" />
            {t("Add unit")}
          </button>
        </div>
      </fieldset>
      {readOnly ? (
        <p className="text-xs text-fg-subtle">{t("Only an HQ administrator can change the product catalogue.")}</p>
      ) : (
        <>
          <FormStatus state={state} />
          <SubmitButton isPending={state.isPending} label={t("Save product")} />
        </>
      )}
    </form>
  );
}
