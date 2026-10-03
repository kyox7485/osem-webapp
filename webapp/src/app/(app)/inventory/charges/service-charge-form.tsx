"use client";

import { useState } from "react";
import { useTranslation } from "@/components/language-provider";
import { todayKL, type InvCatalogue, type InvResident, type InvStaff } from "@/lib/inventory/core";
import { useInvSubmit } from "../components/use-inv-submit";
import { LineEditor, linesToPayload, type EditorLine } from "../components/line-editor";
import { CARD_CLS, Field, FormStatus, INPUT_CLS, ResidentSelect, StaffSelect, SubmitButton } from "../components/form-bits";

/**
 * Charge a service (D-137): no stock moves. Service items only, picked by
 * barcode or exact SKU. An unpriced service becomes PRICE_PENDING.
 */
export function ServiceChargeForm({
  catalogue,
  staff,
  residents,
}: {
  catalogue: InvCatalogue;
  staff: InvStaff[];
  residents: InvResident[];
}) {
  const t = useTranslation();
  const [residentId, setResidentId] = useState("");
  const [date, setDate] = useState(todayKL());
  const [staffId, setStaffId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<EditorLine[]>([]);
  const state = useInvSubmit("inv_charge_service", "inv-charge-service", () => setLines([]));

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payloadLines = linesToPayload(lines);
    if (!payloadLines || payloadLines.length === 0) return state.setError("INVALID_QTY");
    state.submit({
      target: "RESIDENT",
      resident_id: residentId ? Number(residentId) : null,
      charge_date: date,
      performed_by_staff: staffId,
      remarks: remarks || null,
      lines: payloadLines,
    });
  }

  return (
    <form className="space-y-4" onChangeCapture={state.touch} onSubmit={onSubmit}>
      <div className={`${CARD_CLS} grid gap-3 sm:grid-cols-2`}>
        <ResidentSelect residents={residents} value={residentId} onChange={setResidentId} onTouch={state.touch} />
        <Field label={t("Date")} required>
          <input type="date" className={INPUT_CLS} max={todayKL()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <StaffSelect staff={staff} value={staffId} onChange={setStaffId} />
        <Field label={t("Remarks")}>
          <input className={INPUT_CLS} maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
      </div>
      <div className={CARD_CLS}>
        <LineEditor
          catalogue={catalogue}
          lines={lines}
          serviceOnly
          onChange={(next) => {
            state.touch();
            setLines(next);
          }}
        />
      </div>
      <FormStatus state={state} />
      <SubmitButton isPending={state.isPending} label={t("Charge service")} disabled={!residentId || !staffId} />
    </form>
  );
}
