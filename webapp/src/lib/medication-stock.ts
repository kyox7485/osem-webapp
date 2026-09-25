// Medication Stock — pure forecast helpers (client-safe: no server imports).
//
// This is NOT inventory. Doses are signed on paper charts, so real
// consumption is unknown. What we can do:
//   - Count units: forecast = latest event balance − (dose × doses/day) for
//     each scheduled dosing day since that event. A Stock Count resets it.
//   - Estimate units (Bottle, Jar, Drop, …): never auto-decrease; the
//     balance is whatever a nurse last counted/estimated (+ received).
//   - PRN: no forecast (consumption is unpredictable).
//
// The schedule comes from the order exactly as Medication Orders stores it:
// administration_times (comma list — one entry per dose on a dosing day),
// dosing_days ("Everyday" or weekday names), frequency (EOD / Every 3 Days
// intervals are anchored on start_date).
//
// All calendar arithmetic is in Asia/Kuala_Lumpur wall-clock dates.

export const STOCK_UNITS = [
  { unit: "Tablet", tracking: "Count" },
  { unit: "Capsule", tracking: "Count" },
  { unit: "Sachet", tracking: "Count" },
  { unit: "Ampoule", tracking: "Count" },
  { unit: "mL", tracking: "Count" },
  { unit: "Puff", tracking: "Count" },
  { unit: "Bottle", tracking: "Estimate" },
  { unit: "Tube", tracking: "Estimate" },
  { unit: "Jar", tracking: "Estimate" },
  { unit: "Cannister", tracking: "Estimate" },
  { unit: "Pump", tracking: "Estimate" },
  { unit: "Drop", tracking: "Estimate" },
  { unit: "Unit", tracking: "Count" },
  { unit: "Pen", tracking: "Estimate" },
  { unit: "Application", tracking: "Estimate" },
] as const;

export type StockUnit = (typeof STOCK_UNITS)[number]["unit"];
export type TrackingMethod = "Count" | "Estimate";

export const STOCK_ENTRY_TYPES = ["Stock Count", "Stock Received", "Order Changed"] as const;
export type StockEntryType = (typeof STOCK_ENTRY_TYPES)[number];

// Family Medication Reminder threshold (the existing template notifies the
// family when a countable medication has less than 14 days left).
export const LOW_STOCK_DAYS = 14;

export function isStockUnit(value: string): value is StockUnit {
  return STOCK_UNITS.some((u) => u.unit === value);
}

export function trackingFor(unit: string): TrackingMethod | null {
  return STOCK_UNITS.find((u) => u.unit === unit)?.tracking ?? null;
}

// Order dose units are a subset of the stock list except for spelling
// ("ml" vs "mL"). Returns null when there is no sensible default.
export function defaultStockUnitForOrderUnit(orderUnit: string | null): StockUnit | null {
  if (!orderUnit) return null;
  const match = STOCK_UNITS.find((u) => u.unit.toLowerCase() === orderUnit.trim().toLowerCase());
  return match ? match.unit : null;
}

export type StockOrder = {
  dose: number | null;
  unit: string | null; // order dose unit
  frequency: string | null;
  administration_times: string | null;
  dosing_days: string | null;
  start_date: string | null; // YYYY-MM-DD
  end_date?: string | null; // YYYY-MM-DD
};

export function isPrn(order: StockOrder): boolean {
  return (order.frequency ?? "").toUpperCase().includes("PRN");
}

// Fallback when administration_times is blank (older orders).
const DOSES_PER_DAY_BY_FREQUENCY: Record<string, number> = {
  OD: 1,
  OM: 1,
  ON: 1,
  BD: 2,
  TDS: 3,
  QID: 4,
  EOD: 1,
  "Every 3 Days": 1,
  "Selected Days": 1,
};

function dosesPerDosingDay(order: StockOrder): number | null {
  const times = (order.administration_times ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (times.length > 0) return times.length;
  return DOSES_PER_DAY_BY_FREQUENCY[order.frequency ?? ""] ?? null;
}

/**
 * Quantity consumed on each scheduled dosing day, in the stock unit — or
 * null ("—") when it cannot be forecast: Estimate unit, PRN, or the stock is
 * counted in a different unit from the order's dose unit.
 */
export function dailyUsage(order: StockOrder, stockUnit: string): number | null {
  if (trackingFor(stockUnit) !== "Count") return null;
  if (isPrn(order)) return null;
  if (defaultStockUnitForOrderUnit(order.unit) !== stockUnit) return null;
  const perDay = dosesPerDosingDay(order);
  const dose = Number(order.dose);
  if (!perDay || !isFinite(dose) || dose <= 0) return null;
  return round2(dose * perDay);
}

// ── Calendar (KL wall-clock) ──────────────────────────────────────────────────

const TIME_ZONE = "Asia/Kuala_Lumpur";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function klParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    y: get("year"),
    mo: get("month"),
    d: get("day"),
    h: get("hour") === "24" ? "00" : get("hour"),
    mi: get("minute"),
    s: get("second"),
  };
}

/** YYYY-MM-DD in Kuala Lumpur for the given instant. */
export function klDate(date: Date): string {
  const { y, mo, d } = klParts(date);
  return `${y}-${mo}-${d}`;
}

/** Sheet StockDate format: DD/MM/YYYY HH:mm:ss (matches existing AppSheet rows). */
export function toSheetStockDate(date: Date): string {
  const { y, mo, d, h, mi, s } = klParts(date);
  return `${d}/${mo}/${y} ${h}:${mi}:${s}`;
}

function dayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

// Same rule as the medication chart (Apps Script CalendarEngine.gs
// shouldPrepareMedicineOnDay): nothing before Start Date or after End Date.
function isDosingDay(day: number, order: StockOrder): boolean {
  if (order.start_date && day < dayNumber(order.start_date)) return false;
  if (order.end_date && day > dayNumber(order.end_date)) return false;
  const days = (order.dosing_days ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (days.length > 0 && !days.includes("Everyday")) {
    // dayNumber 0 = 1970-01-01, a Thursday.
    const weekday = WEEKDAYS[(day + 4) % 7];
    if (!days.includes(weekday)) return false;
  }

  const interval = order.frequency === "EOD" ? 2 : order.frequency === "Every 3 Days" ? 3 : 1;
  if (interval > 1 && order.start_date) {
    const diff = day - dayNumber(order.start_date);
    if (((diff % interval) + interval) % interval !== 0) return false;
  }
  return true;
}

// ── Forecast ──────────────────────────────────────────────────────────────────

export type StockEvent = {
  balance: number;
  unit: string;
  stock_date: string; // ISO timestamp
};

export type StockStatus = {
  tracking: TrackingMethod | null;
  unit: string | null;
  /** Latest known (Estimate) or forecast (Count) balance; null = never counted. */
  balance: number | null;
  /** True when balance is a calculated forecast rather than a recorded value. */
  forecast: boolean;
  dailyUsage: number | null;
  daysRemaining: number | null;
};

const MAX_FORECAST_DAYS = 3650;

/**
 * Balance on `todayIso` for a Count-unit order: the event's balance minus
 * usage for every dosing day strictly after the event date, up to and
 * including today (Day 1 = recorded value, Day 2 = minus one day's usage …).
 */
function forecastBalance(event: StockEvent, order: StockOrder, usage: number, todayIso: string): number {
  const from = dayNumber(klDate(new Date(event.stock_date)));
  const to = dayNumber(todayIso);
  let consumed = 0;
  for (let day = from + 1; day <= to; day++) {
    if (isDosingDay(day, order)) consumed += usage;
  }
  return Math.max(0, round2(event.balance - consumed));
}

/**
 * Calendar days, starting tomorrow, that the balance still covers: counts
 * forward until the first dosing day whose dose can no longer be met.
 * Non-dosing days in between count as covered, so a Mon/Wed/Fri order is
 * not simply balance ÷ usage. Null when the order's End Date comes first
 * (the supply outlasts the order, so no refill is needed).
 */
export function daysRemaining(balance: number, order: StockOrder, usage: number | null, todayIso: string): number | null {
  if (usage === null || usage <= 0) return null;
  let left = balance;
  let days = 0;
  const start = dayNumber(todayIso);
  const end = order.end_date ? dayNumber(order.end_date) : null;
  for (let day = start + 1; day <= start + MAX_FORECAST_DAYS; day++) {
    if (end !== null && day > end) return null;
    if (isDosingDay(day, order)) {
      if (left + 1e-9 < usage) return days;
      left -= usage;
    }
    days++;
  }
  return days;
}

export function computeStockStatus(latest: StockEvent | null, order: StockOrder, now: Date = new Date()): StockStatus {
  if (!latest) {
    return { tracking: null, unit: null, balance: null, forecast: false, dailyUsage: null, daysRemaining: null };
  }

  const tracking = trackingFor(latest.unit);
  const usage = dailyUsage(order, latest.unit);
  const today = klDate(now);

  if (tracking !== "Count" || usage === null) {
    return {
      tracking,
      unit: latest.unit,
      balance: Number(latest.balance),
      forecast: false,
      dailyUsage: null,
      daysRemaining: null,
    };
  }

  const balance = forecastBalance({ ...latest, balance: Number(latest.balance) }, order, usage, today);
  return {
    tracking,
    unit: latest.unit,
    balance,
    forecast: true,
    dailyUsage: usage,
    daysRemaining: daysRemaining(balance, order, usage, today),
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
