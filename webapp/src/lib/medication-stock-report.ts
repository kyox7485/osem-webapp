// Server-only: builds the grouped stock lists behind the stock PDFs
// (Family Medicine Reminder, OSEM Medicine Purchase List). Never import this
// from a "use client" component (it takes the server Supabase client).

import type { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format-date";
import { LOW_STOCK_DAYS, computeStockStatus, isPrn, round2, type StockOrder, type StockStatus } from "@/lib/medication-stock";
import { STOCK_ORDER_COLUMNS } from "@/lib/medication-stock-server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type StockReportItem = {
  medicine: string;
  schedule: string;
  balance: string;
  status: string;
  statusZh: string;
  /** Second line under the status, e.g. "Last dose Tue 13/10/2026". */
  detail: string | null;
};

export type StockReport = {
  restock: StockReportItem[];
  sufficient: StockReportItem[];
  uncountable: StockReportItem[];
  /** YYYY-MM-DD… of the newest stock entry behind any countable balance; null = none. */
  lastCountableStockDate: string | null;
  /** Number of active orders matched; 0 = nothing to generate. */
  orderCount: number;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function qty(n: number): string {
  return String(round2(n));
}

function dayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()].slice(0, 3)} ${formatDate(isoDate)}`;
}

type OrderRaw = StockOrder & {
  id: number;
  dosage_form: string | null;
  brand_name: string | null;
  active_ingredient: string;
};

function medicineLabel(o: OrderRaw): string {
  const name = o.brand_name ? `${o.brand_name} (${o.active_ingredient})` : o.active_ingredient;
  return [o.dosage_form, name].filter(Boolean).join(" ");
}

function scheduleLabel(o: OrderRaw): string {
  const dose = o.dose !== null ? `${o.dose} ${o.unit ?? ""}`.trim() : "";
  const days =
    o.dosing_days && o.dosing_days !== "Everyday"
      ? o.dosing_days
          .split(",")
          .map((d) => d.trim().slice(0, 3))
          .filter(Boolean)
          .join("/")
      : "";
  return [dose, o.frequency ?? "", days].filter(Boolean).join(" · ");
}

// Active orders supplied by `suppliedBy`, grouped:
//   Countable  → Restock Needed (< LOW_STOCK_DAYS days) / Sufficient Supply
//   Uncountable → Estimate units, PRN, never recorded, unit ≠ dose unit
// Uses the same live forecast as the Stock screen (computeStockStatus).
export async function buildStockReport(
  supabase: Supabase,
  residentId: number,
  suppliedBy: "Family" | "OSEM",
  now: Date
): Promise<{ report: StockReport } | { error: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ordersRaw, error: ordersError } = await (supabase as any)
    .from("tbl_medication_orders")
    .select(`${STOCK_ORDER_COLUMNS}, dosage_form, brand_name, active_ingredient`)
    .eq("resident_id", residentId)
    .eq("status", "Active")
    .eq("supplied_by", suppliedBy)
    .not("external_ref_id", "is", null);
  if (ordersError) return { error: ordersError.message };
  const orders = (ordersRaw ?? []) as OrderRaw[];

  // Latest stock event per order (rows come newest first).
  const latestByOrder = new Map<number, { balance: number; unit: string; stock_date: string }>();
  if (orders.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: stockRaw, error: stockError } = await (supabase as any)
      .from("tbl_medication_stock")
      .select("medication_order_id, balance, unit, stock_date")
      .in("medication_order_id", orders.map((o) => o.id))
      .order("stock_date", { ascending: false })
      .order("id", { ascending: false });
    if (stockError) return { error: stockError.message };
    for (const s of (stockRaw ?? []) as { medication_order_id: number; balance: number; unit: string; stock_date: string }[]) {
      if (!latestByOrder.has(s.medication_order_id)) {
        latestByOrder.set(s.medication_order_id, { balance: Number(s.balance), unit: s.unit, stock_date: s.stock_date });
      }
    }
  }

  const restock: (StockReportItem & { sortDays: number })[] = [];
  const sufficient: (StockReportItem & { sortDays: number })[] = [];
  const uncountable: StockReportItem[] = [];
  let lastCountableStockDate: string | null = null;

  for (const o of orders) {
    const latest = latestByOrder.get(o.id) ?? null;
    const st: StockStatus = computeStockStatus(latest, o, now);
    const base = { medicine: medicineLabel(o), schedule: scheduleLabel(o) };

    if (!latest || st.balance === null || !st.unit) {
      uncountable.push({ ...base, balance: "—", status: "Not recorded yet", statusZh: "尚未记录", detail: null });
      continue;
    }

    const balance = `${qty(st.balance)} ${st.unit}`;

    if (!st.forecast) {
      const counted = `Last counted ${formatDate(latest.stock_date)}`;
      if (isPrn(o)) {
        uncountable.push({ ...base, balance, status: "As needed", statusZh: "按需服用", detail: counted });
      } else {
        const out = st.balance <= 0;
        uncountable.push({
          ...base,
          balance,
          status: out ? "Out of stock" : "In stock",
          statusZh: out ? "已用完" : "有库存",
          detail: counted,
        });
      }
      continue;
    }

    if (!lastCountableStockDate || latest.stock_date > lastCountableStockDate) {
      lastCountableStockDate = latest.stock_date;
    }

    if (st.lastsUntilOrderEnd) {
      sufficient.push({
        ...base,
        balance,
        status: "Enough until order ends",
        statusZh: "足够用至疗程结束",
        detail: `Order ends ${dayLabel(st.lastsUntilOrderEnd)}`,
        sortDays: Number.MAX_SAFE_INTEGER,
      });
      continue;
    }

    const days = st.daysRemaining ?? 0;
    const item = {
      ...base,
      balance,
      status: days === 0 ? "Out of stock" : `${days} days left`,
      statusZh: days === 0 ? "已用完" : `剩余${days}天`,
      detail: st.lastDoseDate ? `Last dose ${dayLabel(st.lastDoseDate)}` : "No doses left after today",
      sortDays: days,
    };
    (days < LOW_STOCK_DAYS ? restock : sufficient).push(item);
  }

  const byDays = (a: { sortDays: number; medicine: string }, b: { sortDays: number; medicine: string }) =>
    a.sortDays - b.sortDays || a.medicine.localeCompare(b.medicine);
  restock.sort(byDays);
  sufficient.sort(byDays);
  uncountable.sort((a, b) => a.medicine.localeCompare(b.medicine));

  return { report: { restock, sufficient, uncountable, lastCountableStockDate, orderCount: orders.length } };
}

export type StockSummaryRow = {
  medicine: string;
  schedule: string;
  balance: string;
  dailyUsage: string;
  /** "12 days left", "Out of stock", "Enough until order ends" or "—". */
  days: string;
  /** Conditional-formatting band, same thresholds as the Stock screen. */
  tone: "out" | "low" | "ok" | "none";
  /** Second line under Days Remaining, e.g. "Last dose Tue 13/10/2026". */
  daysDetail: string | null;
  suppliedBy: string;
  /** DD/MM/YYYY of the latest "Stock Count" entry; null = never counted. */
  lastCount: string | null;
};

// Every active order (any supplier) as one flat table, ordered like the
// Stock screen: regular medication first, PRN last, then alphabetical.
export async function buildStockSummary(
  supabase: Supabase,
  residentId: number,
  now: Date
): Promise<{ rows: StockSummaryRow[] } | { error: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ordersRaw, error: ordersError } = await (supabase as any)
    .from("tbl_medication_orders")
    .select(`${STOCK_ORDER_COLUMNS}, dosage_form, brand_name, active_ingredient, supplied_by`)
    .eq("resident_id", residentId)
    .eq("status", "Active")
    .not("external_ref_id", "is", null);
  if (ordersError) return { error: ordersError.message };
  const orders = (ordersRaw ?? []) as (OrderRaw & { supplied_by: string | null })[];

  type StockRaw = { medication_order_id: number; balance: number; unit: string; stock_date: string; entry_type: string };
  const latestByOrder = new Map<number, StockRaw>();
  const lastCountByOrder = new Map<number, string>();
  if (orders.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: stockRaw, error: stockError } = await (supabase as any)
      .from("tbl_medication_stock")
      .select("medication_order_id, balance, unit, stock_date, entry_type")
      .in("medication_order_id", orders.map((o) => o.id))
      .order("stock_date", { ascending: false })
      .order("id", { ascending: false });
    if (stockError) return { error: stockError.message };
    for (const s of (stockRaw ?? []) as StockRaw[]) {
      if (!latestByOrder.has(s.medication_order_id)) latestByOrder.set(s.medication_order_id, s);
      if (s.entry_type === "Stock Count" && !lastCountByOrder.has(s.medication_order_id)) {
        lastCountByOrder.set(s.medication_order_id, s.stock_date);
      }
    }
  }

  const rows = orders
    .map((o) => {
      const raw = latestByOrder.get(o.id) ?? null;
      const latest = raw ? { balance: Number(raw.balance), unit: raw.unit, stock_date: raw.stock_date } : null;
      const st = computeStockStatus(latest, o, now);
      const lastCount = lastCountByOrder.get(o.id);

      let days = "—";
      let tone: StockSummaryRow["tone"] = "none";
      let daysDetail: string | null = null;
      if (!latest || st.balance === null) {
        daysDetail = "Not recorded yet";
      } else if (!st.forecast) {
        daysDetail = isPrn(o) ? "As needed" : "Uncountable";
      } else if (st.lastsUntilOrderEnd) {
        days = "Enough until order ends";
        tone = "ok";
        daysDetail = `Order ends ${dayLabel(st.lastsUntilOrderEnd)}`;
      } else if (st.daysRemaining !== null) {
        const d = st.daysRemaining;
        days = d === 0 ? "Out of stock" : `${d} days left`;
        tone = d === 0 ? "out" : d < LOW_STOCK_DAYS ? "low" : "ok";
        daysDetail = st.lastDoseDate ? `Last dose ${dayLabel(st.lastDoseDate)}` : "No doses left after today";
      }

      return {
        prn: isPrn(o),
        row: {
          medicine: medicineLabel(o),
          schedule: scheduleLabel(o),
          balance: st.balance === null || !st.unit ? "—" : `${qty(st.balance)} ${st.unit}`,
          dailyUsage: st.dailyUsage === null || !st.unit ? "—" : `${qty(st.dailyUsage)} ${st.unit}`,
          days,
          tone,
          daysDetail,
          suppliedBy: o.supplied_by ?? "—",
          lastCount: lastCount ? formatDate(lastCount) : null,
        } satisfies StockSummaryRow,
      };
    })
    .sort((a, b) => Number(a.prn) - Number(b.prn) || a.row.medicine.localeCompare(b.row.medicine))
    .map((r) => r.row);

  return { rows };
}

// Shown (as a tiny HTML page) when a stock PDF is opened directly for a
// resident with nothing to list. The Stock screen normally prevents this.
export function nothingToGenerateResponse(message: string): Response {
  const esc = message.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OSEM</title>` +
      `<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px;background:#f8fafc;color:#334155}` +
      `@media(prefers-color-scheme:dark){body{background:#0f172a;color:#cbd5e1}}p{max-width:28rem;text-align:center;font-size:15px;line-height:1.5}</style></head>` +
      `<body><p>${esc}</p></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}
