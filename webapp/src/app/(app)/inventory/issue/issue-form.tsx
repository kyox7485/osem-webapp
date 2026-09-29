"use client";

import { useState } from "react";
import { useTranslation } from "@/components/language-provider";
import {
  ISSUE_TARGET_OPTIONS,
  LOCATION_KIND_OPTIONS,
  todayKL,
  type InvCatalogue,
  type InvLocation,
  type InvResident,
  type InvStaff,
} from "@/lib/inventory/core";
import { useInvSubmit } from "../components/use-inv-submit";
import { LineEditor, linesToPayload, type EditorLine } from "../components/line-editor";
import { CARD_CLS, Field, FormStatus, INPUT_CLS, ResidentSelect, StaffSelect, SubmitButton } from "../components/form-bits";

export function IssueForm({
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
  const [locationId, setLocationId] = useState(String(locations.find((l) => l.kind === "FLOOR")?.id ?? locations[0]?.id ?? ""));
  const [target, setTarget] = useState("RESIDENT");
  const [residentId, setResidentId] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayKL());
  const [staffId, setStaffId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<EditorLine[]>([]);
  const state = useInvSubmit("inv_post_issue", "inv-issue", () => setLines([]));

  const fromTransit = locations.find((l) => String(l.id) === locationId)?.kind === "TRANSIT";
  const effectiveTarget = fromTransit ? "RESIDENT" : target;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payloadLines = linesToPayload(lines, () => ({ location_id: Number(locationId) }));
    if (!payloadLines || payloadLines.length === 0) return state.setError("INVALID_QTY");
    state.submit({
      txn_date: date,
      performed_by_staff: staffId,
      target: effectiveTarget,
      resident_id: effectiveTarget === "RESIDENT" && residentId ? Number(residentId) : null,
      expense_note: effectiveTarget === "OSEM_EXPENSE" ? note || null : null,
      remarks: remarks || null,
      lines: payloadLines,
    });
  }

  return (
    <form className="space-y-4" onChangeCapture={state.touch} onSubmit={handleSubmit}>
      <div className={`${CARD_CLS} grid gap-3 sm:grid-cols-3`}>
        <Field label={t("Issue from")} required>
          <select className={INPUT_CLS} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {t(LOCATION_KIND_OPTIONS.find((o) => o.value === l.kind)?.label ?? l.kind)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Issue to")} required>
          <select className={INPUT_CLS} value={effectiveTarget} onChange={(e) => setTarget(e.target.value)} disabled={fromTransit}>
            {ISSUE_TARGET_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.label)}
              </option>
            ))}
          </select>
        </Field>
        {effectiveTarget === "RESIDENT" ? (
          <ResidentSelect residents={residents} value={residentId} onChange={setResidentId} />
        ) : (
          <Field label={t("Expense note")}>
            <input className={INPUT_CLS} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
        <Field label={t("Date")} required>
          <input type="date" className={INPUT_CLS} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <StaffSelect staff={staff} value={staffId} onChange={setStaffId} />
        <Field label={t("Remarks")}>
          <input className={INPUT_CLS} maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
        {fromTransit && <p className="text-xs text-fg-subtle sm:col-span-3">{t("Transit stock can only be issued to its own resident.")}</p>}
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
      <SubmitButton isPending={state.isPending} label={t("Issue")} />
    </form>
  );
}
