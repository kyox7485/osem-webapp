"use client";

import { useState } from "react";
import { useTranslation } from "@/components/language-provider";
import {
  LOCATION_KIND_OPTIONS,
  WRITE_OFF_REASON_OPTIONS,
  todayKL,
  type InvCatalogue,
  type InvLocation,
  type InvResident,
  type InvStaff,
} from "@/lib/inventory/core";
import { useInvSubmit } from "../components/use-inv-submit";
import { LineEditor, linesToPayload, type EditorLine } from "../components/line-editor";
import { CARD_CLS, Field, FormStatus, INPUT_CLS, ResidentSelect, StaffSelect, SubmitButton } from "../components/form-bits";

export function WriteOffForm({
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
  const [date, setDate] = useState(todayKL());
  const [staffId, setStaffId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<EditorLine[]>([]);
  const state = useInvSubmit("inv_post_write_off", "inv-write-off", () => setLines([]));
  const isTransit = locations.find((l) => String(l.id) === locationId)?.kind === "TRANSIT";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payloadLines = linesToPayload(lines);
    if (!payloadLines || payloadLines.length === 0) return state.setError("INVALID_QTY");
    state.submit({
      location_id: Number(locationId),
      resident_id: isTransit && residentId ? Number(residentId) : null,
      reason_code: reason,
      txn_date: date,
      performed_by_staff: staffId,
      remarks: remarks || null,
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
            {WRITE_OFF_REASON_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.label)}
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
        <LineEditor
          catalogue={catalogue}
          lines={lines}
          onChange={(next) => {
            state.touch();
            setLines(next);
          }}
        />
      </div>
      <FormStatus state={state} />
      <SubmitButton isPending={state.isPending} label={t("Write off")} />
    </form>
  );
}
