"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "@/components/language-provider";
import {
  LOCATION_KIND_OPTIONS,
  parseMoney,
  parseQty,
  type InvCatalogue,
  type InvLocation,
  type InvResident,
  type InvStaff,
} from "@/lib/inventory/core";
import { useInvSubmit } from "../components/use-inv-submit";
import { LineEditor, type EditorLine } from "../components/line-editor";
import { CARD_CLS, Field, FormStatus, INPUT_CLS, SMALL_INPUT_CLS, StaffSelect, SubmitButton } from "../components/form-bits";
import { Combobox } from "@/components/combobox";

export function OpeningForm({
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
  const defaultLoc = String(locations.find((l) => l.kind === "STORE")?.id ?? "");
  const [staffId, setStaffId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<EditorLine[]>([]);
  const state = useInvSubmit("inv_post_opening_balance", "inv-opening", () => setLines([]));
  const residentOptions = useMemo(() => residents.map((r) => ({ id: r.id, label: r.name, hint: r.residentCode ?? undefined })), [residents]);
  const kindOf = (id: string) => locations.find((l) => String(l.id) === id)?.kind;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payloadLines = [];
    for (const l of lines) {
      const qty = parseQty(l.qty);
      const cost = parseMoney(l.extra.unit_cost ?? "", false);
      const loc = l.extra.location || defaultLoc;
      if (qty === null) return state.setError("INVALID_QTY");
      if (cost === undefined || cost === null) return state.setError("INVALID_COST");
      payloadLines.push({
        location_id: Number(loc),
        product_id: l.productId,
        uom_id: l.uomId,
        qty,
        unit_cost: cost,
        resident_id: kindOf(loc) === "TRANSIT" && l.extra.resident ? Number(l.extra.resident) : null,
      });
    }
    if (payloadLines.length === 0) return state.setError("INVALID_QTY");
    state.submit({ performed_by_staff: staffId, remarks: remarks || null, lines: payloadLines });
  }

  return (
    <form className="space-y-4" onChangeCapture={state.touch} onSubmit={handleSubmit}>
      <div className={`${CARD_CLS} grid gap-3 sm:grid-cols-2`}>
        <StaffSelect staff={staff} value={staffId} onChange={setStaffId} label={t("Counted by")} />
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
          columns={[
            {
              id: "location",
              label: t("Location"),
              width: "w-32",
              render: (l, setV) => (
                <select className={SMALL_INPUT_CLS} value={l.extra.location || defaultLoc} onChange={(e) => setV(e.target.value)}>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {t(LOCATION_KIND_OPTIONS.find((o) => o.value === loc.kind)?.label ?? loc.kind)}
                    </option>
                  ))}
                </select>
              ),
            },
            {
              id: "resident",
              label: t("Resident (Transit)"),
              width: "w-40",
              render: (l, setV) =>
                kindOf(l.extra.location || defaultLoc) === "TRANSIT" ? (
                  <Combobox
                    hideLabel
                    label={t("Resident (Transit)")}
                    inputClassName={SMALL_INPUT_CLS}
                    value={l.extra.resident ?? ""}
                    onChange={setV}
                    options={residentOptions}
                    emptyMessage={t("No matching resident")}
                  />
                ) : null,
            },
            {
              id: "unit_cost",
              label: t("Unit cost (per unit)"),
              width: "w-28",
              render: (l, setV) => <input className={SMALL_INPUT_CLS} inputMode="decimal" value={l.extra.unit_cost ?? ""} onChange={(e) => setV(e.target.value)} />,
            },
          ]}
        />
        <p className="mt-2 text-xs text-fg-subtle">{t("One line per product; add the same product in another location as a separate opening entry.")}</p>
      </div>
      <FormStatus state={state} />
      <SubmitButton isPending={state.isPending} label={t("Post opening balance")} />
    </form>
  );
}
