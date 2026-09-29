"use client";

import { useState } from "react";
import { useTranslation } from "@/components/language-provider";
import { useNavPush } from "@/components/nav-loading";
import {
  COUNT_TYPE_OPTIONS,
  LOCATION_KIND_OPTIONS,
  defaultFreeze,
  labelOf,
  type InvLocation,
  type InvStaff,
} from "@/lib/inventory/core";
import { useInvSubmit } from "../components/use-inv-submit";
import { CARD_CLS, Field, FormStatus, INPUT_CLS, StaffSelect, SubmitButton } from "../components/form-bits";

/**
 * Start a count (D-104): pick the location and type; a monthly Store count
 * freezes its location by default, the others do not. The counter is the
 * staff member who will do the counting (any active staff of the branch).
 */
export function StartCountForm({
  branchId,
  locations,
  staff,
}: {
  branchId: number;
  locations: InvLocation[];
  staff: InvStaff[];
}) {
  const t = useTranslation();
  const push = useNavPush();
  const [locationId, setLocationId] = useState("");
  const [countType, setCountType] = useState("");
  const [freeze, setFreeze] = useState<boolean | null>(null); // null = follow the type's default
  const [staffId, setStaffId] = useState("");
  const state = useInvSubmit("inv_start_count", "inv-count-start", (data) => {
    if (data?.count_id) push(`/inventory/counts/${String(data.count_id)}?branch=${branchId}`);
  });
  const effectiveFreeze = freeze ?? defaultFreeze(countType);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    state.submit({
      location_id: Number(locationId),
      count_type: countType,
      freeze_location: effectiveFreeze,
      counted_by_staff: staffId,
    });
  }

  return (
    <form onSubmit={onSubmit} onChangeCapture={state.touch} className={`${CARD_CLS} space-y-3`}>
      <h2 className="text-sm font-semibold text-fg">{t("Start a count")}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("Location")} required>
          <select className={INPUT_CLS} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">{t("Select location")}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {t(labelOf(LOCATION_KIND_OPTIONS, l.kind))}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Count type")} required>
          <select className={INPUT_CLS} value={countType} onChange={(e) => setCountType(e.target.value)}>
            <option value="">{t("Select count type")}</option>
            {COUNT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.label)}
              </option>
            ))}
          </select>
        </Field>
        <StaffSelect staff={staff} value={staffId} onChange={setStaffId} label={t("Counted by")} />
        <label className="flex items-start gap-2 self-end pb-2 text-sm text-fg-secondary">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={effectiveFreeze}
            onChange={(e) => setFreeze(e.target.checked)}
          />
          <span>
            {t("Freeze this location while counting")}
            <span className="block text-xs text-fg-subtle">
              {t("Receipts, issues and transfers are blocked at the location until the count is submitted.")}
            </span>
          </span>
        </label>
      </div>
      <FormStatus state={state} />
      <SubmitButton
        isPending={state.isPending}
        label={t("Start count")}
        disabled={!locationId || !countType || !staffId}
      />
    </form>
  );
}
