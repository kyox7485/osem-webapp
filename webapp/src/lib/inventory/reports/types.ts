import {
  INV_TIER,
  LOCATION_KIND_OPTIONS,
  REQUEST_STATUS_OPTIONS,
  TXN_TYPE_LABELS,
  formatMoney,
  formatQty,
  type LocationKind,
} from "../core";

// Client-safe pieces of the Inventory reports (Phase 7): the report registry,
// the filter vocabulary and the result shape every loader returns. Nothing
// here touches the database or next/headers, so pages, the export route and
// the PDF document can all import it.

export const REPORT_KEYS = [
  "stock",
  "ledger",
  "valuation",
  "suggested",
  "receiving",
  "transfers",
  "requests",
  "charges",
  "expense",
  "counts",
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export type FilterKey =
  | "q"
  | "category"
  | "status"
  | "supplier"
  | "from"
  | "to"
  | "location"
  | "type"
  | "month"
  | "view"
  | "kind"
  | "reqstatus"
  | "only";

export type ReportDef = {
  key: ReportKey;
  label: string;
  minRank: number;
  filters: FilterKey[];
  /** date range (from/to) is required and at most 366 days */
  ranged: boolean;
};

// Stock and Ledger live on their own pages (Stock, Transactions -> Ledger); the
// rest are the sub-tabs of /inventory/reports.
export const REPORTS: Record<ReportKey, ReportDef> = {
  stock: { key: "stock", label: "Stock balance", minRank: INV_TIER.VIEW, filters: ["q", "category", "status", "supplier"], ranged: false },
  ledger: { key: "ledger", label: "Movement", minRank: INV_TIER.VIEW, filters: ["q", "from", "to", "location", "type"], ranged: true },
  valuation: { key: "valuation", label: "Valuation", minRank: INV_TIER.VIEW_COST, filters: ["month"], ranged: false },
  suggested: { key: "suggested", label: "Suggested order", minRank: INV_TIER.VIEW, filters: ["category", "supplier"], ranged: false },
  receiving: { key: "receiving", label: "Receiving history", minRank: INV_TIER.RECEIPT, filters: ["from", "to", "supplier", "q"], ranged: true },
  transfers: { key: "transfers", label: "Transfers", minRank: INV_TIER.TRANSFER, filters: ["from", "to", "kind"], ranged: true },
  requests: { key: "requests", label: "Stock requests", minRank: INV_TIER.STOCK_REQUEST, filters: ["from", "to", "reqstatus"], ranged: true },
  charges: { key: "charges", label: "Resident charges", minRank: INV_TIER.PRICE_PENDING, filters: ["month", "view"], ranged: false },
  expense: { key: "expense", label: "OSEM expense", minRank: INV_TIER.PRICE_PENDING, filters: ["from", "to", "view"], ranged: true },
  counts: { key: "counts", label: "Count variance", minRank: INV_TIER.COUNT, filters: ["from", "to", "location", "only"], ranged: true },
};

/** The reports shown as sub-tabs of /inventory/reports (Stock and Movement have their own pages). */
export const REPORT_TAB_KEYS: ReportKey[] = ["valuation", "suggested", "receiving", "transfers", "requests", "charges", "expense", "counts"];

export function isReportKey(value: string): value is ReportKey {
  return (REPORT_KEYS as readonly string[]).includes(value);
}

export const FILTER_LABELS: Record<FilterKey, string> = {
  q: "Product (name, SKU or barcode)",
  category: "Category",
  status: "Product status",
  supplier: "Supplier",
  from: "From",
  to: "To",
  location: "Location",
  type: "Transaction type",
  month: "Month",
  view: "View",
  kind: "Kind",
  reqstatus: "Request status",
  only: "Show",
};

/** Label of a filter on a given report (receiving history searches the invoice number, not the product). */
export function filterLabel(report: ReportKey, key: FilterKey): string {
  if (report === "receiving" && key === "q") return "Invoice no.";
  return FILTER_LABELS[key];
}

export const STOCK_STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
] as const;
export const VIEW_OPTIONS = [
  { value: "summary", label: "Summary" },
  { value: "lines", label: "Line by line" },
] as const;
export const TRANSFER_KIND_OPTIONS = [
  { value: "internal", label: "Internal (Store, Floor, Transit)" },
  { value: "branch", label: "Between branches" },
] as const;
export const COUNT_ONLY_OPTIONS = [{ value: "variance", label: "Variances only" }] as const;

/** Options of the fixed-vocabulary selects; category, supplier and locked months are loaded per request. */
export const STATIC_FILTER_OPTIONS: Partial<Record<FilterKey, readonly { value: string; label: string }[]>> = {
  status: STOCK_STATUS_OPTIONS,
  location: LOCATION_KIND_OPTIONS,
  type: Object.entries(TXN_TYPE_LABELS).map(([value, label]) => ({ value, label })),
  view: VIEW_OPTIONS,
  kind: TRANSFER_KIND_OPTIONS,
  reqstatus: REQUEST_STATUS_OPTIONS,
  only: COUNT_ONLY_OPTIONS,
};

export type ReportParams = {
  q: string;
  category: number | null;
  status: "active" | "inactive" | "all";
  supplier: number | null;
  from: string;
  to: string;
  location: LocationKind | "";
  type: string;
  month: string;
  view: "summary" | "lines";
  kind: "" | "internal" | "branch";
  reqstatus: string;
  only: "" | "variance";
};

export type ColKind = "text" | "int" | "qty" | "money" | "money4" | "date";
export type ReportColumn = { key: string; label: string; kind: ColKind };
export type ReportCell = string | number | null;
export type ReportRow = Record<string, ReportCell>;

/** A fully display-ready report: labels and enum cells are already translated. */
export type ReportResult = {
  key: ReportKey;
  title: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportRow | null;
  /** more rows matched than the cap allowed */
  truncated: boolean;
  notes: string[];
  filters: { label: string; value: string }[];
  error: "QUERY_FAILED" | null;
};

export const SCREEN_ROW_CAP = 500;
export const PDF_ROW_CAP = 5000;
export const CSV_ROW_CAP = 20000;
export const MAX_RANGE_DAYS = 366;

/** Display text of a cell (screen and PDF); CSV uses the raw number instead. */
export function formatCell(kind: ColKind, value: ReportCell): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  switch (kind) {
    case "qty":
      return formatQty(value);
    case "money":
      return formatMoney(value, 2);
    case "money4":
      return formatMoney(value, 4);
    default:
      return String(value);
  }
}
