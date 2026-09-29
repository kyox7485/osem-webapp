"use client";

import { useState } from "react";
import { useTranslation } from "@/components/language-provider";
import { useInvSubmit } from "../components/use-inv-submit";
import { CARD_CLS, ErrorNotice, INPUT_CLS, SECONDARY_BTN_CLS, Spinner } from "../components/form-bits";

export type BillingResident = { id: number; name: string; residentCode: string | null; status: string; code: string };

function CodeRow({ resident }: { resident: BillingResident }) {
  const t = useTranslation();
  const [code, setCode] = useState(resident.code);
  const state = useInvSubmit("inv_set_resident_billing_code", `inv-billing-code-${resident.id}`);
  const changed = code.trim() !== resident.code && code.trim() !== "";
  return (
    <tr>
      <td className="px-3 py-2 text-fg">
        {resident.name}
        <div className="text-xs text-fg-subtle">{resident.residentCode}</div>
      </td>
      <td className="px-3 py-2 text-fg-secondary">{resident.status === "ACTIVE" ? t("Active") : t("Inactive")}</td>
      <td className="px-3 py-2">
        <form
          className="flex items-center gap-2"
          onChangeCapture={state.touch}
          onSubmit={(e) => {
            e.preventDefault();
            state.submit({ resident_id: resident.id, billing_code: code.trim() });
          }}
        >
          <input
            className={`${INPUT_CLS} max-w-56`}
            maxLength={40}
            value={code}
            aria-label={t("Billing code")}
            onChange={(e) => setCode(e.target.value)}
          />
          <button type="submit" className={SECONDARY_BTN_CLS} disabled={state.isPending || !changed}>
            {state.isPending && <Spinner />}
            {t("Save")}
          </button>
          {state.success && <span className="text-xs text-emerald-700 dark:text-emerald-300">{t("Saved.")}</span>}
        </form>
        <ErrorNotice code={state.error} />
      </td>
    </tr>
  );
}

/** Bukku customer code per resident (D-122). An export stops at MISSING_BILLING_CODE until every charged resident has one. */
export function BillingCodesPanel({ residents }: { residents: BillingResident[] }) {
  const t = useTranslation();
  const [filter, setFilter] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const missing = residents.filter((r) => r.code === "").length;
  const shown = residents.filter(
    (r) =>
      (!onlyMissing || r.code === "") &&
      `${r.name} ${r.residentCode ?? ""} ${r.code}`.toLowerCase().includes(filter.trim().toLowerCase())
  );
  return (
    <section className={`${CARD_CLS} space-y-3`}>
      <h2 className="text-sm font-semibold text-fg">{t("Resident billing codes")}</h2>
      <p className="text-xs text-fg-subtle">
        {missing} {t("residents have no billing code yet.")}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          className={`${INPUT_CLS} max-w-xs`}
          placeholder={t("Search residents")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={t("Search residents")}
        />
        <label className="flex items-center gap-2 text-sm text-fg-secondary">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
          {t("Only without a code")}
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs text-fg-subtle">
            <tr>
              <th className="px-3 py-2 font-medium">{t("Resident")}</th>
              <th className="px-3 py-2 font-medium">{t("Status")}</th>
              <th className="px-3 py-2 font-medium">{t("Billing code")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {shown.map((r) => (
              <CodeRow key={`${r.id}-${r.code}`} resident={r} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
