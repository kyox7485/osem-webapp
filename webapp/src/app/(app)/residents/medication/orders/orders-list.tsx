"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useTranslation } from "@/components/language-provider";

type OrderItem = {
  id: number;
  rxOrderId: string;
  activeIngredient: string;
  brandName: string | null;
  dose: string | null;
  unit: string | null;
  frequency: string | null;
  startDate: string;
  endDate: string | null;
  status: string;
  orderedBy: string;
  residentName: string;
  residentTextId: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  Active:
    "bg-green-50 text-green-700 ring-1 ring-green-600/20",
  Discontinued:
    "bg-red-50 text-red-700 ring-1 ring-red-600/20",
  Completed:
    "bg-gray-100 text-gray-600 ring-1 ring-gray-500/20",
  "On Hold":
    "bg-amber-50 text-amber-700 ring-1 ring-amber-600/20",
};

function statusClass(status: string) {
  return (
    STATUS_COLORS[status] ??
    "bg-gray-100 text-gray-600 ring-1 ring-gray-500/20"
  );
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function OrdersList({ orders }: { orders: OrderItem[] }) {
  const t = useTranslation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return orders.filter((o) => {
      const matchesSearch =
        !q ||
        o.residentName.toLowerCase().includes(q) ||
        (o.residentTextId?.toLowerCase() ?? "").includes(q) ||
        o.activeIngredient.toLowerCase().includes(q) ||
        (o.brandName?.toLowerCase() ?? "").includes(q) ||
        o.rxOrderId.includes(q);
      const matchesStatus =
        statusFilter === "all" || o.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [orders, search, statusFilter]);

  const statuses = useMemo(
    () => [...new Set(orders.map((o) => o.status))].sort(),
    [orders]
  );

  if (orders.length === 0) {
    return (
      <div className="rounded-md border border-gray-200 bg-white px-6 py-12 text-center shadow-sm">
        <p className="text-sm text-gray-400">{t("No orders found.")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("Search by resident, drug...")}
          className="flex-1 min-w-[180px] rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        >
          <option value="all">{t("All statuses")}</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {t(s)}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white px-6 py-8 text-center text-sm text-gray-400 shadow-sm">
          {t("No orders match the current filter.")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-gray-200 shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 bg-white text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t("Resident")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t("Drug")}
                </th>
                <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t("Dosing")}
                </th>
                <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t("Start Date")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t("Status")}
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((order) => (
                <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{order.residentName}</p>
                    {order.residentTextId && (
                      <p className="text-xs text-gray-400 mt-0.5">{order.residentTextId}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-gray-900">{order.activeIngredient}</p>
                    {order.brandName && (
                      <p className="text-xs text-gray-400 mt-0.5">{order.brandName}</p>
                    )}
                  </td>
                  <td className="hidden sm:table-cell px-4 py-3 text-gray-600">
                    {[
                      [order.dose, order.unit].filter(Boolean).join(" "),
                      order.frequency,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                  <td className="hidden md:table-cell px-4 py-3 text-gray-600">
                    {formatDate(order.startDate)}
                    {order.endDate && (
                      <span className="text-gray-400">
                        {" → "}{formatDate(order.endDate)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(order.status)}`}
                    >
                      {t(order.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/residents/medication/orders/${order.rxOrderId}/edit`}
                      className="rounded-md px-2.5 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
                    >
                      {t("Edit")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
