"use client";

import { useEffect } from "react";
import { useTranslation } from "@/components/language-provider";
import { X, Pencil } from "lucide-react";
import { SECONDARY_BTN_CLS } from "../components/form-bits";

export function StockItemDetailModal({
  productId,
  productName,
  sku,
  categoryName,
  supplierName,
  isActive,
  costPrice,
  sellingPrice,
  storeQty,
  floorQty,
  transitQty,
  totalQty,
  unit,
  onClose,
  onQuickEdit,
}: {
  productId: number;
  productName: string;
  sku: string;
  categoryName: string | null;
  supplierName: string | null;
  isActive: boolean | null;
  costPrice: number | null;
  sellingPrice: number | null;
  storeQty: number;
  floorQty: number;
  transitQty: number;
  totalQty: number;
  unit: string;
  onClose: () => void;
  /** Omitted for logins below MODERATOR -- the Quick edit action is hidden. */
  onQuickEdit?: () => void;
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
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-4">
          <div className="min-w-0">
            <h2 id="item-detail-title" className="truncate text-base font-bold text-fg">{productName}</h2>
            <p className="text-xs text-fg-subtle">SKU: {sku}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("Close")} className="-mr-1 -mt-1 shrink-0 rounded p-2 hover:bg-hover text-fg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Particulars */}
        <div className="grid grid-cols-2 gap-3 px-6 pb-4 text-sm">
          <div>
            <span className="text-xs text-fg-subtle block">{t("Category")}</span>
            <span className="text-fg">{categoryName ?? "—"}</span>
          </div>
          <div>
            <span className="text-xs text-fg-subtle block">{t("Supplier")}</span>
            <span className="text-fg">{supplierName ?? "—"}</span>
          </div>
          <div>
            <span className="text-xs text-fg-subtle block">{t("Status")}</span>
            <span className={isActive === null ? "text-fg-subtle" : isActive ? "text-green-600 dark:text-green-400" : "text-fg-subtle"}>
              {isActive === null ? "—" : isActive ? t("Active") : t("Inactive")}
            </span>
          </div>
          <div>
            <span className="text-xs text-fg-subtle block">{t("Unit")}</span>
            <span className="text-fg">{unit || "—"}</span>
          </div>
          <div>
            <span className="text-xs text-fg-subtle block">{t("Cost price")}</span>
            <span className="text-fg">{costPrice !== null ? `RM ${costPrice.toFixed(4)}` : "—"}</span>
          </div>
          <div>
            <span className="text-xs text-fg-subtle block">{t("Selling price")}</span>
            <span className="text-fg">{sellingPrice !== null ? `RM ${sellingPrice.toFixed(2)}` : "—"}</span>
          </div>
        </div>

        {/* Stock by location */}
        <div className="border-t border-line px-6 py-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{t("Stock by location")}</h3>
          <div className="grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-4">
            <div className="rounded bg-surface-muted p-2">
              <div className="text-xs text-fg-subtle">{t("Store")}</div>
              <div className="font-medium text-fg">{storeQty} {unit}</div>
            </div>
            <div className="rounded bg-surface-muted p-2">
              <div className="text-xs text-fg-subtle">{t("Floor")}</div>
              <div className="font-medium text-fg">{floorQty} {unit}</div>
            </div>
            <div className="rounded bg-surface-muted p-2">
              <div className="text-xs text-fg-subtle">{t("Transit")}</div>
              <div className="font-medium text-fg">{transitQty} {unit}</div>
            </div>
            <div className="rounded bg-surface-muted p-2">
              <div className="text-xs text-fg-subtle">{t("Total")}</div>
              <div className="font-medium text-fg font-bold">{totalQty} {unit}</div>
            </div>
          </div>
        </div>

        {/* Actions */}
        {onQuickEdit && (
          <div className="border-t border-line px-6 py-4">
            <button type="button" onClick={onQuickEdit} className={SECONDARY_BTN_CLS + " flex items-center gap-2"}>
              <Pencil className="h-4 w-4" /> {t("Quick edit")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
