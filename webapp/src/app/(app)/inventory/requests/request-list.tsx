"use client";

import Link from "next/link";
import { useTranslation } from "@/components/language-provider";
import { useNavPush } from "@/components/nav-loading";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { REQUEST_STATUS_OPTIONS } from "@/lib/inventory/core";
import { EmptyState, INPUT_CLS } from "../components/form-bits";
import { RequestStatusBadge } from "./status-badge";

export type RequestListRow = {
  id: number;
  requestNo: string;
  status: string;
  statusLabel: string;
  staff: string;
  createdAt: string;
  externalRef: string | null;
  expectedDelivery: string | null;
  lineCount: number;
};

/** Request list with a status filter (?status=, so the filtered view can be linked). */
export function RequestList({ branchId, rows, status }: { branchId: number; rows: RequestListRow[]; status: string }) {
  const t = useTranslation();
  const push = useNavPush();
  const { guardedAction } = useSafeNavigation();
  const filter = (value: string) =>
    guardedAction(() => push(`/inventory/requests?branch=${branchId}&view=list${value ? `&status=${value}` : ""}`));

  return (
    <section className="space-y-3">
      <label className="flex max-w-xs items-center gap-2 text-sm text-fg-secondary">
        {t("Status")}
        <select className={INPUT_CLS} value={status} onChange={(e) => filter(e.target.value)}>
          <option value="">{t("All statuses")}</option>
          {REQUEST_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.label)}
            </option>
          ))}
        </select>
      </label>
      {rows.length === 0 ? (
        <EmptyState text={t("No stock requests yet.")} />
      ) : (
        <ul className="divide-y divide-line-subtle rounded-lg border border-line bg-surface shadow-sm">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/inventory/requests/${r.id}?branch=${branchId}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-hover"
              >
                <span className="font-semibold text-fg">{r.requestNo}</span>
                <RequestStatusBadge status={r.status} label={r.statusLabel} />
                <span className="text-fg-subtle">{r.staff}</span>
                <span className="text-fg-subtle">{r.createdAt.slice(0, 10)}</span>
                <span className="text-fg-subtle">
                  {r.lineCount} {t("items")}
                </span>
                {r.externalRef && <span className="text-fg-secondary">{r.externalRef}</span>}
                {r.expectedDelivery && (
                  <span className="text-fg-subtle">
                    {t("Expected")}: {r.expectedDelivery}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
