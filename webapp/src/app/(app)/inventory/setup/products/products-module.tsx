"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "@/components/language-provider";
import { Combobox } from "@/components/combobox";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import type { InvCatalogue, InvCategory, InvStaff, InvSupplier, InvProduct } from "@/lib/inventory/core";
import type { LookupOption } from "@/lib/types";
import { SECONDARY_BTN_CLS } from "../../components/form-bits";
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
  const { catalogue } = props;
  const [selected, setSelected] = useState<number | "new" | null>(props.initialProductId);

  // Name and SKU share one label so the shared Combobox's single
  // substring filter matches either -- the old input filtered on both too.
  const productOptions = useMemo<LookupOption[]>(
    () =>
      catalogue.products
        .map((p: InvProduct) => ({ id: p.id, label: `${p.name} — ${p.sku}` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [catalogue.products]
  );

  const product = typeof selected === "number" ? catalogue.products.find((p) => p.id === selected) : undefined;
  const canEdit = (owner: number | null) => (owner === null ? props.isHqAdmin : props.isDemoAdmin);
  // switching the product being edited is a local state change: guard it (CLAUDE.md)
  const select = (next: number | "new" | null) => guardedAction(() => setSelected(next));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Combobox
              id="product-search"
              hideLabel
              label={t("Search product")}
              placeholder={t("Search product by name or SKU")}
              emptyMessage={t("Not found")}
              value={typeof selected === "number" ? String(selected) : ""}
              // The Combobox clears the value to "" while the user is typing;
              // that's not a selection change, so leave the editor alone.
              onChange={(id) => id && select(Number(id))}
              options={productOptions}
            />
          </div>
          {props.canCreate && (
            <button type="button" className={SECONDARY_BTN_CLS} onClick={() => select("new")}>
              <Plus className="h-4 w-4" />
              {t("New")}
            </button>
          )}
        </div>
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
