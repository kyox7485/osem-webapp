"use client";

import { useState } from "react";
import { useTranslation } from "@/components/language-provider";
import {
  ADJUSTMENT_REASON_OPTIONS,
  LOCATION_KIND_OPTIONS,
  parseQty,
  type InvCatalogue,
  type InvLocation,
  type InvResident,
  type InvStaff,
} from "@/lib/inventory/core";
import { useInvSubmit } from "../components/use-inv-submit";
import { LineEditor, type EditorLine } from "../components/line-editor";
import { CARD_CLS, Field, FormStatus, INPUT_CLS, ResidentSelect, SMALL_INPUT_CLS, StaffSelect, SubmitButton } from "../components/form-bits";

/** Request an adjustment; quantities are in the base unit, with a +/− direction per line. */
export function AdjustmentRequestForm({
  locations,
  catalogue,
  staff,
  residents,
}: {
  locations: InvLocation[];
  catalogue: InvCatalogue;
  staff: InvStaff[];
  residents: InvResident[];
}) {
  const t = useTranslation();
  const [locationId, setLocationId] = useState(String(locations.find((l) => l.kind === "STORE")?.id ?? ""));
  const [residentId, setResidentId] = useState("");
  const [reason, setReason] = useState("");
  const [justification, setJustification] = useState("");
  const [staffId, setStaffId] = useState("");
  const [lines, setLines] = useState<EditorLine[]>([]);
  const state = useInvSubmit("inv_request_adjustment", "inv-adjustment-request", () => {
    setLines([]);
    setJustification("");
  });
  const isTransit = locations.find((l) => String(l.id) === locationId)?.kind === "TRANSIT";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payloadLines = [];
    for (const l of lines) {
      const qty = parseQty(l.qty);
      if (qty === null) return state.setError("INVALID_QTY");
      payloadLines.push({
        product_id: l.productId,
        resident_id: isTransit && residentId ? Number(residentId) : null,
        qty_delta_base: l.extra.dir === "+" ? qty : -qty,
      });
    }
    if (payloadLines.length === 0) return state.setError("INVALID_QTY");
    state.submit({
      location_id: Number(locationId),
      reason_code: reason,
      justification,
      performed_by_staff: staffId,
      lines: payloadLines,
    });
  }

  return (
    <form className="space-y-4" onChangeCapture={state.touch} onSubmit={handleSubmit}>
      <div className={`${CARD_CLS} grid gap-3 sm:grid-cols-3`}>
        <Field label={t("Location")} required>
          <select className={INPUT_CLS} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {t(LOCATION_KIND_OPTIONS.find((o) => o.value === l.kind)?.label ?? l.kind)}
              </option>
            ))}
          </select>
        </Field>
        {isTransit && <ResidentSelect residents={residents} value={residentId} onChange={setResidentId} onTouch={state.touch} />}
        <Field label={t("Reason")} required>
          <select className={INPUT_CLS} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">{t("Select reason")}</option>
            {ADJUSTMENT_REASON_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.label)}
              </option>
            ))}
          </select>
        </Field>
        <StaffSelect staff={staff} value={staffId} onChange={setStaffId} seniorOnly label={t("Requested by")} />
        <div className="sm:col-span-3">
          <Field label={t("Justification")} required>
            <textarea className={INPUT_CLS} rows={2} maxLength={1000} value={justification} onChange={(e) => setJustification(e.target.value)} />
          </Field>
        </div>
      </div>
      <div className={CARD_CLS}>
        <LineEditor
          catalogue={catalogue}
          lines={lines}
          allowUomChange={false}
          onChange={(next) => {
            state.touch();
            setLines(next);
          }}
          columns={[
            {
              id: "dir",
              label: t("Direction"),
              width: "w-32",
              render: (l, setV) => (
                <select className={SMALL_INPUT_CLS} value={l.extra.dir ?? "-"} onChange={(e) => setV(e.target.value)}>
                  <option value="-">{t("Remove (−)")}</option>
                  <option value="+">{t("Add (+)")}</option>
                </select>
              ),
            },
          ]}
        />
        <p className="mt-2 text-xs text-fg-subtle">{t("Quantities are in the product's base unit. Nothing changes until the request is approved.")}</p>
      </div>
      <FormStatus state={state} />
      <SubmitButton isPending={state.isPending} label={t("Request adjustment")} />
    </form>
  );
}
