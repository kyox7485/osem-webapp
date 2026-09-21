"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { useTranslation } from "@/components/language-provider";
import { discontinueOrderAction } from "./order-actions";

export type OrderItem = {
  id: number;
  rxOrderId: string;
  dosageForm: string | null;
  activeIngredient: string;
  brandName: string | null;
  dose: string | null;
  unit: string | null;
  frequency: string | null;
  dosingDays: string | null;
  startDate: string;
  endDate: string | null;
  status: string;
  orderedBy: string;
  residentName: string;
  residentTextId: string | null;
  residentId: number;
};

// Build the full one-line drug label (used in the discontinue confirmation modal).
function formatDrugLabel(order: OrderItem): string {
  const days = order.dosingDays
    ? order.dosingDays
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .join("/")
    : null;

  return [
    order.dosageForm,
    order.activeIngredient,
    [order.dose, order.unit].filter(Boolean).join(" "),
    order.frequency,
    days,
  ]
    .filter(Boolean)
    .join(" ") || "—";
}

// Active ingredient + dosing schedule on one line (rows 2 of the 3-row drug cell).
function formatIngredientLine(order: OrderItem): string {
  const days = order.dosingDays
    ? order.dosingDays
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .join("/")
    : null;
  return [
    order.activeIngredient,
    [order.dose, order.unit].filter(Boolean).join(" "),
    order.frequency,
    days,
  ]
    .filter(Boolean)
    .join(" ") || "—";
}

const STATUS_COLORS: Record<string, string> = {
  Active: "bg-green-50 text-green-700 ring-1 ring-green-600/20",
  Discontinued: "bg-red-50 text-red-700 ring-1 ring-red-600/20",
  Completed: "bg-gray-100 text-gray-600 ring-1 ring-gray-500/20",
  "On Hold": "bg-amber-50 text-amber-700 ring-1 ring-amber-600/20",
};

function statusClass(s: string) {
  return STATUS_COLORS[s] ?? "bg-gray-100 text-gray-600 ring-1 ring-gray-500/20";
}

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function DiscontinueModal({
  order,
  onClose,
  onConfirm,
  isPending,
}: {
  order: OrderItem;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const t = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-5 w-5 text-red-600"
            >
              <path
                fillRule="evenodd"
                d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-gray-900">
              {t("Discontinue Order")}
            </h3>
            <p className="mt-1.5 text-sm text-gray-500">
              {t("Are you sure you want to discontinue this order for")}{" "}
              <span className="font-medium text-gray-800">
                {order.residentName}
              </span>
              ?
            </p>
            <p className="mt-1.5 rounded-md bg-gray-50 px-2.5 py-1.5 font-mono text-xs text-gray-500">
              {formatDrugLabel(order)}
            </p>
            <p className="mt-2 text-xs text-red-500">
              {t("This action cannot be undone.")}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {isPending ? (
              <span className="inline-flex items-center gap-1.5">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                {t("Discontinuing...")}
              </span>
            ) : (
              t("Confirm Discontinue")
            )}
          </button>
          <button
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {t("Cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function OrdersList({ orders }: { orders: OrderItem[] }) {
  const t = useTranslation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [discontinuingId, setDiscontinuingId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [localStatuses, setLocalStatuses] = useState<Record<number, string>>({});
  const [discontinueError, setDiscontinueError] = useState<string | null>(null);

  const orderToDiscontinue =
    discontinuingId !== null ? orders.find((o) => o.id === discontinuingId) ?? null : null;

  function handleDiscontinueConfirm() {
    if (discontinuingId === null) return;
    const order = orders.find((o) => o.id === discontinuingId);
    if (!order) return;
    setDiscontinueError(null);
    startTransition(async () => {
      const result = await discontinueOrderAction(order.rxOrderId);
      if (!result.success) {
        setDiscontinueError(result.error ?? "Unknown error");
      } else {
        setLocalStatuses((prev) => ({ ...prev, [discontinuingId]: "Discontinued" }));
      }
      setDiscontinuingId(null);
    });
  }

  const allStatuses = useMemo(
    () => [...new Set(orders.map((o) => localStatuses[o.id] ?? o.status))].sort(),
    [orders, localStatuses]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return orders.filter((o) => {
      const effectiveStatus = localStatuses[o.id] ?? o.status;
      const matchesSearch =
        !q ||
        o.residentName.toLowerCase().includes(q) ||
        (o.residentTextId?.toLowerCase() ?? "").includes(q) ||
        o.activeIngredient.toLowerCase().includes(q) ||
        (o.brandName?.toLowerCase() ?? "").includes(q) ||
        (o.dosageForm?.toLowerCase() ?? "").includes(q) ||
        o.rxOrderId.includes(q);
      const matchesStatus = statusFilter === "all" || effectiveStatus === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [orders, search, statusFilter, localStatuses]);

  // Group by resident name, sort residents alphabetically
  const grouped = useMemo(() => {
    const map = new Map<string, OrderItem[]>();
    for (const o of filtered) {
      if (!map.has(o.residentName)) map.set(o.residentName, []);
      map.get(o.residentName)!.push(o);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  if (orders.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-6 py-12 text-center shadow-sm">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="mx-auto mb-3 h-10 w-10 text-gray-300"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
        </svg>
        <p className="text-sm font-medium text-gray-400">{t("No orders found.")}</p>
      </div>
    );
  }

  return (
    <>
      {orderToDiscontinue && (
        <DiscontinueModal
          order={orderToDiscontinue}
          onClose={() => setDiscontinuingId(null)}
          onConfirm={handleDiscontinueConfirm}
          isPending={isPending}
        />
      )}

      <div className="space-y-4">
        {/* Filter bar */}
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Search by resident, drug...")}
            className="min-w-[180px] flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="all">{t("All statuses")}</option>
            {allStatuses.map((s) => (
              <option key={s} value={s}>
                {t(s)}
              </option>
            ))}
          </select>
        </div>

        {discontinueError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {discontinueError}
          </div>
        )}

        {grouped.length === 0 ? (
          <div className="rounded-md border border-gray-200 bg-white px-6 py-8 text-center text-sm text-gray-400 shadow-sm">
            {t("No orders match the current filter.")}
          </div>
        ) : (
          <div className="space-y-4">
            {grouped.map(([residentName, residentOrders]) => {
              const firstOrder = residentOrders[0];
              const activeCount = residentOrders.filter(
                (o) => (localStatuses[o.id] ?? o.status) === "Active"
              ).length;

              return (
                <div
                  key={residentName}
                  className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
                >
                  {/* Resident header row */}
                  <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-semibold text-gray-800 truncate">
                        {residentName}
                      </span>
                      {firstOrder.residentTextId && (
                        <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-500">
                          {firstOrder.residentTextId}
                        </span>
                      )}
                    </div>
                    {activeCount > 0 && (
                      <span className="shrink-0 text-xs text-gray-400">
                        {activeCount}{" "}
                        {activeCount === 1 ? t("active order") : t("active orders")}
                      </span>
                    )}
                  </div>

                  {/* Orders table */}
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-100 text-sm">
                      <thead>
                        <tr className="bg-white">
                          <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
                            {t("Dosage")}
                          </th>
                          <th className="hidden md:table-cell px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
                            {t("Start Date")}
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
                            {t("Status")}
                          </th>
                          <th className="px-4 py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {residentOrders.map((order) => {
                          const effectiveStatus = localStatuses[order.id] ?? order.status;
                          const isActive = effectiveStatus === "Active";
                          return (
                            <tr
                              key={order.id}
                              className="transition-colors hover:bg-gray-50/60"
                            >
                              <td className="px-4 py-3">
                                <div className="space-y-0.5">
                                  {order.dosageForm && (
                                    <p className="text-xs text-gray-400">
                                      {order.dosageForm}
                                    </p>
                                  )}
                                  <p className="font-medium text-gray-900">
                                    {formatIngredientLine(order)}
                                  </p>
                                  {order.brandName && (
                                    <p className="text-xs text-gray-400">
                                      {order.brandName}
                                    </p>
                                  )}
                                </div>
                              </td>
                              <td className="hidden md:table-cell px-4 py-3 text-gray-500">
                                {formatDate(order.startDate)}
                                {order.endDate && (
                                  <span className="text-gray-400">
                                    {" → "}
                                    {formatDate(order.endDate)}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <span
                                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(effectiveStatus)}`}
                                >
                                  {t(effectiveStatus)}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-1">
                                  {effectiveStatus === "Discontinued" ? (
                                    <Link
                                      href={`/residents/medication/orders/${order.rxOrderId}/edit`}
                                      className="rounded-md px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
                                    >
                                      {t("Restart order")}
                                    </Link>
                                  ) : (
                                    <Link
                                      href={`/residents/medication/orders/${order.rxOrderId}/edit`}
                                      className="rounded-md px-2.5 py-1.5 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                                    >
                                      {t("Edit order")}
                                    </Link>
                                  )}
                                  {isActive && (
                                    <button
                                      type="button"
                                      onClick={() => setDiscontinuingId(order.id)}
                                      disabled={isPending}
                                      className="rounded-md px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                                    >
                                      {t("Discontinue")}
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
