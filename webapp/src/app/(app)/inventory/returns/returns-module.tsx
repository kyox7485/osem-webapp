"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "@/components/language-provider";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { TabRow, TabButton } from "@/components/tabs";
import {
  LOCATION_KIND_OPTIONS,
  formatQty,
  parseMoney,
  parseQty,
  todayKL,
  type InvCatalogue,
  type InvLocation,
  type InvStaff,
  type InvSupplier,
} from "@/lib/inventory/core";
import { useInvSubmit } from "../components/use-inv-submit";
import { LineEditor, linesToPayload, type EditorLine } from "../components/line-editor";
import { CARD_CLS, EmptyState, Field, FormStatus, INPUT_CLS, SMALL_INPUT_CLS, StaffSelect, SubmitButton } from "../components/form-bits";

export type IssueLineOption = {
  id: number;
  txnNo: string;
  date: string;
  productName: string;
  baseUomId: number;
  target: string;
  residentId: number | null;
  residentName: string;
  available: number;
};
export type ReceiptOption = { id: number; label: string; supplierId: number };

type Props = {
  locations: InvLocation[];
  catalogue: InvCatalogue;
  staff: InvStaff[];
  suppliers: InvSupplier[];
  receipts: ReceiptOption[];
  issueLines: IssueLineOption[];
  canReturnToSupplier: boolean;
};

export function ReturnsModule(props: Props) {
  const t = useTranslation();
  const { guardedAction } = useSafeNavigation();
  const [tab, setTab] = useState<"issue" | "supplier">("issue");
  return (
    <div className="space-y-3">
      <TabRow>
        <TabButton size="sm" active={tab === "issue"} onClick={() => guardedAction(() => setTab("issue"))}>
          {t("Return from issue")}
        </TabButton>
        {props.canReturnToSupplier && (
          <TabButton size="sm" active={tab === "supplier"} onClick={() => guardedAction(() => setTab("supplier"))}>
            {t("Return to supplier")}
          </TabButton>
        )}
      </TabRow>
      {tab === "issue" ? <FromIssueForm {...props} /> : <ToSupplierForm {...props} />}
    </div>
  );
}

function kindLabel(locations: InvLocation[], id: string, t: (s: string) => string) {
  const k = locations.find((l) => String(l.id) === id)?.kind;
  return t(LOCATION_KIND_OPTIONS.find((o) => o.value === k)?.label ?? "");
}

function FromIssueForm({ locations, staff, issueLines }: Props) {
  const t = useTranslation();
  const [filter, setFilter] = useState("");
  const [locationId, setLocationId] = useState(String(locations.find((l) => l.kind === "STORE")?.id ?? ""));
  const [date, setDate] = useState(todayKL());
  const [staffId, setStaffId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [qty, setQty] = useState<Record<number, string>>({});
  const state = useInvSubmit("inv_post_return_from_issue", "inv-return-issue", () => setQty({}));

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return issueLines.filter(
      (l) => !q || l.productName.toLowerCase().includes(q) || l.residentName.toLowerCase().includes(q) || l.txnNo.toLowerCase().includes(q)
    );
  }, [filter, issueLines]);

  if (issueLines.length === 0) return <EmptyState text={t("No recent issues to return.")} />;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const lines = [];
    for (const [id, value] of Object.entries(qty)) {
      if (value.trim() === "") continue;
      const n = parseQty(value);
      const line = issueLines.find((l) => l.id === Number(id));
      if (n === null || !line) return state.setError("INVALID_QTY");
      lines.push({ issue_line_id: line.id, uom_id: line.baseUomId, qty: n });
    }
    if (lines.length === 0) return state.setError("INVALID_QTY");
    state.submit({ location_id: Number(locationId), txn_date: date, performed_by_staff: staffId, remarks: remarks || null, lines });
  }

  return (
    <form className="space-y-4" onChangeCapture={state.touch} onSubmit={handleSubmit}>
      <div className={`${CARD_CLS} grid gap-3 sm:grid-cols-4`}>
        <Field label={t("Return into")} required hint={t("Transit only for the resident the goods were issued to")}>
          <select className={INPUT_CLS} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {kindLabel(locations, String(l.id), t)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Date")} required>
          <input type="date" className={INPUT_CLS} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <StaffSelect staff={staff} value={staffId} onChange={setStaffId} />
        <Field label={t("Remarks")}>
          <input className={INPUT_CLS} maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
      </div>
      <div className={CARD_CLS}>
        <input
          className={`${SMALL_INPUT_CLS} mb-3`}
          placeholder={t("Filter by resident, product or number")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={t("Filter")}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs text-fg-subtle">
              <tr>
                <th className="px-2 py-2 font-medium">{t("Date")}</th>
                <th className="px-2 py-2 font-medium">{t("Issued to")}</th>
                <th className="px-2 py-2 font-medium">{t("Product")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("Returnable (base unit)")}</th>
                <th className="w-28 px-2 py-2 font-medium">{t("Return qty")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {visible.map((l) => (
                <tr key={l.id}>
                  <td className="px-2 py-2 text-fg-secondary">
                    {l.date}
                    <div className="text-xs text-fg-subtle">{l.txnNo}</div>
                  </td>
                  <td className="px-2 py-2 text-fg">{l.target === "RESIDENT" ? l.residentName : t("OSEM expense")}</td>
                  <td className="px-2 py-2 text-fg">{l.productName}</td>
                  <td className="px-2 py-2 text-right text-fg-secondary">{formatQty(l.available)}</td>
                  <td className="px-2 py-2">
                    <input
                      className={SMALL_INPUT_CLS}
                      inputMode="decimal"
                      maxLength={12}
                      value={qty[l.id] ?? ""}
                      onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
                      aria-label={t("Return qty")}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <FormStatus state={state} />
      <SubmitButton isPending={state.isPending} label={t("Record return")} />
    </form>
  );
}

function ToSupplierForm({ locations, catalogue, staff, suppliers, receipts }: Props) {
  const t = useTranslation();
  const storeId = locations.find((l) => l.kind === "STORE")?.id;
  const [supplierId, setSupplierId] = useState("");
  const [receiptId, setReceiptId] = useState("");
  const [credit, setCredit] = useState("");
  const [date, setDate] = useState(todayKL());
  const [staffId, setStaffId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<EditorLine[]>([]);
  const state = useInvSubmit("inv_post_return_to_supplier", "inv-return-supplier", () => setLines([]));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payloadLines = linesToPayload(lines);
    const creditValue = parseMoney(credit);
    if (!payloadLines || payloadLines.length === 0) return state.setError("INVALID_QTY");
    if (creditValue === undefined) return state.setError("INVALID_NUMBER");
    state.submit({
      location_id: storeId ?? null,
      supplier_id: supplierId ? Number(supplierId) : null,
      receipt_id: receiptId ? Number(receiptId) : null,
      supplier_credit_value: creditValue,
      txn_date: date,
      performed_by_staff: staffId,
      remarks: remarks || null,
      lines: payloadLines,
    });
  }

  return (
    <form className="space-y-4" onChangeCapture={state.touch} onSubmit={handleSubmit}>
      <div className={`${CARD_CLS} grid gap-3 sm:grid-cols-3`}>
        <Field label={t("Supplier")} required>
          <select
            className={INPUT_CLS}
            value={supplierId}
            onChange={(e) => {
              setSupplierId(e.target.value);
              setReceiptId("");
            }}
          >
            <option value="">{t("Select supplier")}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Receipt (optional)")}>
          <select className={INPUT_CLS} value={receiptId} onChange={(e) => setReceiptId(e.target.value)}>
            <option value="">{t("Not linked")}</option>
            {receipts
              .filter((r) => String(r.supplierId) === supplierId)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
          </select>
        </Field>
        <Field label={t("Supplier credit (RM)")} hint={t("For information only")}>
          <input className={INPUT_CLS} inputMode="decimal" value={credit} onChange={(e) => setCredit(e.target.value)} />
        </Field>
        <Field label={t("Date")} required>
          <input type="date" className={INPUT_CLS} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <StaffSelect staff={staff} value={staffId} onChange={setStaffId} seniorOnly />
        <Field label={t("Remarks")}>
          <input className={INPUT_CLS} maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
        <p className="text-xs text-fg-subtle sm:col-span-3">{t("Goods leave the Store at the current average cost.")}</p>
      </div>
      <div className={CARD_CLS}>
        <LineEditor
          catalogue={catalogue}
          lines={lines}
          defaultUom="purchase"
          onChange={(next) => {
            state.touch();
            setLines(next);
          }}
        />
      </div>
      <FormStatus state={state} />
      <SubmitButton isPending={state.isPending} label={t("Return to supplier")} />
    </form>
  );
}
