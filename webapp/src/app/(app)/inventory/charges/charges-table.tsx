"use client";

import { Fragment, useState } from "react";
import { useTranslation } from "@/components/language-provider";
import { CHARGE_KIND_OPTIONS, INV_TIER, formatMoney, formatQty, labelOf, type InvChargeLine, type InvStaff } from "@/lib/inventory/core";
import { SECONDARY_BTN_CLS } from "../components/form-bits";
import { PriceForm, ReverseChargeForm } from "./charge-actions";

const AMOUNT_CLS = "px-3 py-2 text-right tabular-nums";

/**
 * The month's charges. Children (pricing, return credits, reversals) sit under
 * their line; the effective amount of a line is the sum over it and its
 * children (D-121). Actions follow the tier: price = moderator; reversing a
 * service charge = moderator (stock charges are reversed with their transaction).
 */
export function ChargesTable({
  lines,
  residentNames,
  rank,
  staff,
  isLocked,
}: {
  lines: InvChargeLine[];
  residentNames: Record<number, string>;
  rank: number;
  staff: InvStaff[];
  isLocked: boolean;
}) {
  const t = useTranslation();
  const [open, setOpen] = useState<{ id: number; mode: "price" | "reverse" } | null>(null);
  const close = () => setOpen(null);

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted text-left text-xs text-fg-subtle">
          <tr>
            <th className="px-3 py-2 font-medium">{t("Date")}</th>
            <th className="px-3 py-2 font-medium">{t("Resident")}</th>
            <th className="px-3 py-2 font-medium">{t("Product")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("Qty")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("Unit price")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("Amount")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("Line total")}</th>
            <th className="px-3 py-2 font-medium">{t("Kind")}</th>
            <th className="px-3 py-2 font-medium">{t("Txn no.")}</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">
          {lines.map((l) => {
            const canPrice = rank >= INV_TIER.PRICE_PENDING && l.isPricePending && !isLocked;
            const canReverse = rank >= INV_TIER.REVERSE && l.kind === "SERVICE" && !l.isChild && !l.isReversed;
            return (
              <Fragment key={l.id}>
                <tr className={l.isChild ? "bg-surface-muted/50" : ""}>
                  <td className="whitespace-nowrap px-3 py-2 text-fg-secondary">{l.chargeDate}</td>
                  <td className="px-3 py-2 text-fg">{l.residentId !== null ? (residentNames[l.residentId] ?? `#${l.residentId}`) : t("OSEM expense")}</td>
                  <td className={`px-3 py-2 text-fg ${l.isChild ? "pl-8" : ""}`}>
                    {l.productName}
                    <div className="text-xs text-fg-subtle">{l.sku}</div>
                    {l.reason && <div className="text-xs text-fg-subtle">{l.reason}</div>}
                  </td>
                  <td className={`${AMOUNT_CLS} text-fg-secondary`}>{l.qtyBase !== 0 ? `${formatQty(l.qtyBase)} ${l.uomCode}` : ""}</td>
                  <td className={`${AMOUNT_CLS} text-fg-secondary`}>{l.unitPrice !== null ? formatMoney(l.unitPrice, 2) : ""}</td>
                  <td className={`${AMOUNT_CLS} text-fg`}>{formatMoney(l.amount)}</td>
                  <td className={`${AMOUNT_CLS} font-medium text-fg`}>{l.effective !== null ? formatMoney(l.effective) : ""}</td>
                  <td className="px-3 py-2">
                    <span className="text-fg-secondary">{t(labelOf(CHARGE_KIND_OPTIONS, l.kind))}</span>
                    {l.isPricePending && (
                      <span className="ml-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                        {t("Price pending")}
                      </span>
                    )}
                    {l.isReversed && (
                      <span className="ml-2 inline-flex rounded-full bg-surface-strong px-2 py-0.5 text-xs font-medium text-fg-secondary">
                        {t("Reversed")}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-fg-subtle">{l.txnNo ?? ""}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      {canPrice && (
                        <button type="button" className={SECONDARY_BTN_CLS} onClick={() => setOpen({ id: l.id, mode: "price" })}>
                          {t("Price")}
                        </button>
                      )}
                      {canReverse && (
                        <button type="button" className={SECONDARY_BTN_CLS} onClick={() => setOpen({ id: l.id, mode: "reverse" })}>
                          {t("Reverse")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {open?.id === l.id && (
                  <tr>
                    <td colSpan={10} className="px-3 py-3">
                      {open.mode === "price" ? (
                        <PriceForm chargeId={l.id} staff={staff} onClose={close} />
                      ) : (
                        <ReverseChargeForm chargeId={l.id} staff={staff} onClose={close} />
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
