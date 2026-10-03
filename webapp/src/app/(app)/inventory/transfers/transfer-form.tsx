"use client";

import { useState } from "react";
import { useTranslation } from "@/components/language-provider";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { TabRow, TabButton } from "@/components/tabs";
import {
  LOCATION_KIND_OPTIONS,
  RELEASE_REASON_OPTIONS,
  todayKL,
  type InvBranch,
  type InvCatalogue,
  type InvLocation,
  type InvResident,
  type InvStaff,
} from "@/lib/inventory/core";
import { useInvSubmit } from "../components/use-inv-submit";
import {
  LineEditor,
  linesToPayload,
  type EditorLine,
} from "../components/line-editor";
import {
  CARD_CLS,
  Field,
  FormStatus,
  INPUT_CLS,
  ResidentSelect,
  StaffSelect,
  SubmitButton,
  SCROLL_TABROW_CLS,
  TAB_BTN_CLS,
} from "../components/form-bits";

type Kind = "INTERNAL" | "BRANCH";
/** The RPC kind an Internal Transfer maps to, derived from the From/To locations. */
type Op = "INTERNAL" | "ALLOCATE" | "RELEASE";

type Props = {
  locations: InvLocation[];
  catalogue: InvCatalogue;
  staff: InvStaff[];
  residents: InvResident[];
  destinations: InvBranch[];
  canRelease: boolean;
};

export function TransferForm(props: Props) {
  const t = useTranslation();
  const { guardedAction } = useSafeNavigation();
  const [kind, setKind] = useState<Kind>("INTERNAL");
  const kinds: { value: Kind; label: string }[] = [
    { value: "INTERNAL", label: "Internal Transfer" },
    { value: "BRANCH", label: "External Transfer" },
  ];
  return (
    <div className="space-y-3">
      <TabRow className={SCROLL_TABROW_CLS}>
        {kinds.map((k) => (
          // local tab toggle: guarded so a dirty form is not silently discarded (CLAUDE.md)
          <TabButton
            className={TAB_BTN_CLS}
            key={k.value}
            size="sm"
            active={kind === k.value}
            onClick={() => guardedAction(() => setKind(k.value))}
          >
            {t(k.label)}
          </TabButton>
        ))}
      </TabRow>
      <KindForm key={kind} kind={kind} {...props} />
    </div>
  );
}

function KindForm({
  kind,
  locations,
  catalogue,
  staff,
  residents,
  destinations,
  canRelease,
}: Props & { kind: Kind }) {
  const t = useTranslation();
  const store = locations.find((l) => l.kind === "STORE");
  const floor = locations.find((l) => l.kind === "FLOOR");
  const transit = locations.find((l) => l.kind === "TRANSIT");
  const [fromId, setFromId] = useState(String(store?.id ?? ""));
  const [toId, setToId] = useState(String(floor?.id ?? ""));
  const [residentId, setResidentId] = useState("");
  const [reason, setReason] = useState("");
  const [toBranch, setToBranch] = useState("");
  const [date, setDate] = useState(todayKL());
  const [staffId, setStaffId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<EditorLine[]>([]);
  const rpc =
    kind === "BRANCH" ? "inv_dispatch_branch_transfer" : "inv_post_transfer";
  const state = useInvSubmit(rpc, `inv-transfer-${kind}`, () => setLines([]));

  // Store, Floor Stock and Transit are three equal locations; the direction
  // decides which existing RPC kind is used.
  const transitId = transit ? String(transit.id) : null;
  const op: Op =
    kind === "BRANCH"
      ? "INTERNAL"
      : fromId === transitId
        ? "RELEASE"
        : toId === transitId
          ? "ALLOCATE"
          : "INTERNAL";
  const sameLocation = kind === "INTERNAL" && fromId !== "" && fromId === toId;
  const internalBlocked =
    kind === "INTERNAL" && (sameLocation || fromId === "" || toId === "");
  const allLocations = [store, floor, transit].filter(
    (l): l is InvLocation => !!l,
  );
  const fromOptions =
    kind === "BRANCH"
      ? [store, floor].filter((l): l is InvLocation => !!l)
      : allLocations.filter((l) => l.kind !== "TRANSIT" || canRelease);
  const kindLabel = (l: InvLocation) =>
    t(LOCATION_KIND_OPTIONS.find((o) => o.value === l.kind)?.label ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (internalBlocked) return;
    const payloadLines = linesToPayload(lines);
    if (!payloadLines || payloadLines.length === 0)
      return state.setError("INVALID_QTY");
    const common = {
      txn_date: date,
      performed_by_staff: staffId,
      remarks: remarks || null,
      lines: payloadLines,
    };
    if (kind === "BRANCH") {
      state.submit({
        ...common,
        from_location_id: Number(fromId),
        to_branch_id: toBranch ? Number(toBranch) : null,
      });
    } else {
      state.submit({
        ...common,
        kind: op,
        from_location_id: Number(fromId),
        to_location_id: toId ? Number(toId) : null,
        resident_id:
          op === "INTERNAL" ? null : residentId ? Number(residentId) : null,
        reason_code: op === "RELEASE" ? reason : null,
      });
    }
  }

  return (
    <form
      className="space-y-4"
      onChangeCapture={state.touch}
      onSubmit={handleSubmit}
    >
      <div className={`${CARD_CLS} grid gap-3 sm:grid-cols-3`}>
        <Field label={t("From")} required>
          <select
            className={INPUT_CLS}
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
          >
            {fromOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {kindLabel(l)}
              </option>
            ))}
          </select>
        </Field>
        {kind === "BRANCH" ? (
          <Field label={t("To branch")} required>
            <select
              className={INPUT_CLS}
              value={toBranch}
              onChange={(e) => setToBranch(e.target.value)}
            >
              <option value="">{t("Select branch")}</option>
              {destinations.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label={t("To")} required>
            <select
              className={INPUT_CLS}
              value={toId}
              onChange={(e) => setToId(e.target.value)}
            >
              {allLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {kindLabel(l)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {(op === "ALLOCATE" || op === "RELEASE") && (
          <ResidentSelect
            residents={residents.filter(
              (r) => op === "RELEASE" || r.status === "ACTIVE",
            )}
            value={residentId}
            onChange={setResidentId}
            onTouch={state.touch}
          />
        )}
        {op === "RELEASE" && (
          <Field label={t("Reason")} required>
            <select
              className={INPUT_CLS}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              <option value="">{t("Select reason")}</option>
              {RELEASE_REASON_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.label)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t("Date")} required>
          <input
            type="date"
            className={INPUT_CLS}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <StaffSelect
          staff={staff}
          value={staffId}
          onChange={setStaffId}
          seniorOnly={op === "RELEASE"}
        />
        <Field label={t("Remarks")}>
          <input
            className={INPUT_CLS}
            maxLength={500}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
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
      {sameLocation && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          {t("From and To must be different locations.")}
        </p>
      )}
      <FormStatus state={state} />
      <SubmitButton
        disabled={internalBlocked}
        isPending={state.isPending}
        label={kind === "BRANCH" ? t("Dispatch") : t("Move stock")}
      />
    </form>
  );
}
