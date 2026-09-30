"use client";

import { useEffect } from "react";
import { useTranslation } from "@/components/language-provider";
import { X, Pencil } from "lucide-react";
import { SECONDARY_BTN_CLS } from "../components/form-bits";
import type { InvProduct } from "@/lib/inventory/core";

export function StockItemDetailModal({
  product,
  storeQty,
  floorQty,
  transitQty,
  totalQty,
  unit,
  onClose,
  onQuickEdit,
}: {
  product: InvProduct;
  storeQty: number;
  floorQty: number;
  transitQty: number;
  totalQty: number;
  unit: string;
  onClose: () => void;
  onQuickEdit: () => void;
}) {
  const t = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="item-detail-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface shadow-2xl p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 id="item-detail-title" className="text-base font-bold text-fg">{product.name}</h2>
            <p className="text-xs text-fg-subtle">SKU: {product.sku}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("Close")} className="-mr-1 -mt-1 rounded p-2 hover:bg-hover text-fg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm mb-4">
          <div><span className="text-fg-subtle">Category:</span> <span className="text-fg">{product.categoryId}</span></div>
          <div><span className="text-fg-subtle">Supplier:</span> <span className="text-fg">{product.defaultSupplierId ?? "—"}</span></div>
          <div><span className="text-fg-subtle">Status:</span> <span className="text-fg">{product.isActive ? t("Active") : t("Inactive")}</span></div>
          <div><span className="text-fg-subtle">Unit:</span> <span className="text-fg">{unit}</span></div>
          <div><span className="text-fg-subtle">Cost:</span> <span className="text-fg">{product.standardUnitCost !== null ? `RM ${product.standardUnitCost}` : "—"}</span></div>
          <div><span className="text-fg-subtle">Selling:</span> <span className="text-fg">{product.chargePrice !== null ? `RM ${product.chargePrice}` : "—"}</span></div>
        </div>

        <div className="border-t border-line pt-3 mb-4">
          <h3 className="text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-2">{t("Stock by location")}</h3>
          <div className="grid grid-cols-4 gap-2 text-center text-sm">
            <div className="rounded bg-surface-muted p-2"><div className="text-xs text-fg-subtle">Store</div><div className="font-medium text-fg">{storeQty} {unit}</div></div>
            <div className="rounded bg-surface-muted p-2"><div className="text-xs text-fg-subtle">Floor</div><div className="font-medium text-fg">{floorQty} {unit}</div></div>
            <div className="rounded bg-surface-muted p-2"><div className="text-xs text-fg-subtle">Transit</div><div className="font-medium text-fg">{transitQty} {unit}</div></div>
            <div className="rounded bg-surface-muted p-2"><div className="text-xs text-fg-subtle">Total</div><div className="font-medium text-fg">{totalQty} {unit}</div></div>
          </div>
        </div>

        {product.description && (
          <p className="text-sm text-fg-secondary mb-4 whitespace-pre-wrap">{product.description}</p>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={onQuickEdit} className={SECONDARY_BTN_CLS + " flex items-center gap-2"}>
            <Pencil className="h-4 w-4" /> {t("Quick edit")}
          </button>
        </div>
      </div>
    </div>
  );
}
