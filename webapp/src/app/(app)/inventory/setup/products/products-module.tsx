"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "@/components/language-provider";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { formatMoney, uomLabel, type InvCatalogue, type InvCategory, type InvStaff, type InvSupplier } from "@/lib/inventory/core";
import { SECONDARY_BTN_CLS, SMALL_INPUT_CLS } from "../../components/form-bits";
import { ProductEditor } from "./product-editor";
import { BarcodePanel } from "./barcode-panel";

export type ProductsModuleProps = {
  catalogue: InvCatalogue;
  categories: InvCategory[];
  suppliers: InvSupplier[];
  staff: InvStaff[];
  canCreate: boolean;
  isHqAdmin: boolean;
  isDemoAdmin: boolean;
  canAttachBarcode: boolean;
  initialProductId: number | null;
};

export function ProductsModule(props: ProductsModuleProps) {
  const t = useTranslation();
  const { guardedAction } = useSafeNavigation();
  const { catalogue, categories } = props;
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<number | "new" | null>(props.initialProductId);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return catalogue.products.filter((p) => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [filter, catalogue.products]);
  const product = typeof selected === "number" ? catalogue.products.find((p) => p.id === selected) : undefined;
  const canEdit = (owner: number | null) => (owner === null ? props.isHqAdmin : props.isDemoAdmin);
  // switching the product being edited is a local state change: guard it (CLAUDE.md)
  const select = (next: number | "new" | null) => guardedAction(() => setSelected(next));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            className={SMALL_INPUT_CLS}
            placeholder={t("Search product by name or SKU")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label={t("Search product")}
          />
          {props.canCreate && (
            <button type="button" className={SECONDARY_BTN_CLS} onClick={() => select("new")}>
              <Plus className="h-4 w-4" />
              {t("New")}
            </button>
          )}
        </div>
        <ul className="max-h-[70vh] divide-y divide-line-subtle overflow-auto rounded-lg border border-line bg-surface shadow-sm">
          {visible.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-hover ${selected === p.id ? "bg-selected text-selected-fg" : "text-fg"}`}
                onClick={() => select(p.id)}
              >
                <span className={p.isActive ? "" : "line-through opacity-60"}>{p.name}</span>
                <span className="ml-2 text-xs text-fg-subtle">
                  {p.sku} · {categoryName.get(p.categoryId)} · {uomLabel(catalogue.uoms, p.baseUomId)}
                  {p.chargePrice !== null ? ` · RM ${formatMoney(p.chargePrice)}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-4">
        {selected === "new" && <ProductEditor key="new" {...props} product={undefined} readOnly={false} />}
        {product && (
          <>
            <ProductEditor key={product.id} {...props} product={product} readOnly={!canEdit(product.ownerBranchId)} />
            <BarcodePanel
              key={`bc-${product.id}`}
              product={product}
              catalogue={catalogue}
              staff={props.staff}
              canManage={canEdit(product.ownerBranchId)}
              canAttach={canEdit(product.ownerBranchId) || (product.ownerBranchId === null && props.canAttachBarcode)}
            />
          </>
        )}
        {selected === null && <p className="text-sm text-fg-subtle">{t("Select a product to view or edit it.")}</p>}
      </div>
    </div>
  );
}
