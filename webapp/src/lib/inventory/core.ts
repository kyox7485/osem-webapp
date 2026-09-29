// General Inventory — client-safe types, vocabularies and helpers.
// NEVER import anything server-only here (next/headers, supabase/server):
// "use client" components import this file (CLAUDE.md build footgun).
// The DB is authoritative for every rule; this file only formats and
// mirrors the capability ranks so the UI can hide what would be refused.

export type InvRank = 0 | 1 | 2 | 3 | 4;

/** Mirrors SQL fn_inv_rank_for_rights / fn_inv_action_tier (schema/008). */
export const INV_TIER = {
  VIEW: 1,
  ISSUE: 1,
  TRANSFER: 1,
  WRITE_OFF: 1,
  RETURN_FROM_ISSUE: 1,
  RECEIPT: 2,
  TRANSIT_RELEASE: 2,
  BRANCH_CANCEL: 2,
  RETURN_TO_SUPPLIER: 2,
  ADJUSTMENT_REQUEST: 2,
  SUPPLIER_EDIT: 2,
  BARCODE_ATTACH: 2,
  VIEW_COST: 2,
  REVERSE: 3,
  ADJUSTMENT_APPROVE: 3,
  STOCK_REQUEST: 2,
  COUNT: 1,
  COUNT_INVESTIGATE: 2,
  REQUEST_APPROVE: 4,
  OPENING_BALANCE: 4,
  STOCK_LEVELS: 4,
} as const;

export type LocationKind = "STORE" | "FLOOR" | "TRANSIT";

export type InvLocation = { id: number; branchId: number; kind: LocationKind };
export type InvUom = { id: number; code: string; name: string; nameMs: string | null; allowFraction: boolean };
export type InvProductUom = { uomId: number; factor: number; isActive: boolean };
export type InvBarcode = { id: number; barcode: string; productId: number; uomId: number; ownerBranchId: number | null };
export type InvProduct = {
  id: number;
  sku: string;
  name: string;
  description: string | null;
  categoryId: number;
  isStockItem: boolean;
  baseUomId: number;
  purchaseUomId: number;
  defaultSupplierId: number | null;
  standardUnitCost: number | null;
  isChargeable: boolean;
  chargePrice: number | null;
  defaultMaxStore: number | null;
  defaultMaxFloor: number | null;
  isActive: boolean;
  ownerBranchId: number | null;
  uoms: InvProductUom[];
};
export type InvCategory = { id: number; code: string; name: string; nameMs: string | null; isService: boolean };
export type InvSupplier = {
  id: number;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  ownerBranchId: number | null;
};
export type InvStaff = { id: string; name: string; isSenior: boolean };
export type InvResident = { id: number; name: string; residentCode: string | null; status: string };
export type InvBranch = { id: number; label: string };
/** A stock request a delivery can be received against, with its outstanding lines (base units). */
export type InvOpenRequest = {
  id: number;
  requestNo: string;
  status: string;
  externalRef: string | null;
  supplierId: number | null;
  lines: { productId: number; outstandingBase: number }[];
};

/** Everything a posting form needs, loaded once by the page. */
export type InvCatalogue = {
  products: InvProduct[];
  uoms: InvUom[];
  barcodes: InvBarcode[];
};

export type RpcResult =
  | { ok: true; data: Record<string, unknown> | null; replayed?: boolean }
  | { ok: false; code: string; message?: string; data?: unknown };

// The RPC names the Server Action may call (defence in depth: a whitelist).
export const INV_RPCS = [
  "inv_post_receipt",
  "inv_post_issue",
  "inv_post_transfer",
  "inv_post_write_off",
  "inv_dispatch_branch_transfer",
  "inv_receive_branch_transfer",
  "inv_cancel_branch_transfer",
  "inv_reverse_txn",
  "inv_post_opening_balance",
  "inv_post_return_from_issue",
  "inv_post_return_to_supplier",
  "inv_request_adjustment",
  "inv_decide_adjustment",
  "inv_save_product",
  "inv_add_barcode",
  "inv_deactivate_barcode",
  "inv_save_supplier",
  "inv_set_stock_level",
  "inv_create_stock_request",
  "inv_decide_stock_request",
  "inv_stock_request_action",
  "inv_start_count",
  "inv_save_count_lines",
  "inv_submit_count",
  "inv_review_count",
  "inv_cancel_count",
] as const;
export type InvRpcName = (typeof INV_RPCS)[number];

/** Soft rejections answered by re-submitting with a flag and the SAME key (§4.5). */
export const CONFIRM_FLAGS: Record<string, string> = {
  NEGATIVE_STOCK_CONFIRM: "allow_negative",
  SANITY_CONFIRM: "sanity_confirmed",
  INACTIVE_RESIDENT_CONFIRM: "inactive_resident_confirmed",
};

// ----------------------------------------------------------------- vocabularies
// {value, label}: the value is stored/sent as is; the label goes through t().

export const LOCATION_KIND_OPTIONS: { value: LocationKind; label: string }[] = [
  { value: "STORE", label: "Store" },
  { value: "FLOOR", label: "Floor Stock" },
  { value: "TRANSIT", label: "Transit" },
];

export const ISSUE_TARGET_OPTIONS = [
  { value: "RESIDENT", label: "Resident" },
  { value: "OSEM_EXPENSE", label: "OSEM expense" },
] as const;

export const DOC_TYPE_OPTIONS = [
  { value: "INVOICE", label: "Invoice" },
  { value: "CASH_BILL", label: "Cash bill" },
] as const;

export const WRITE_OFF_REASON_OPTIONS = [
  { value: "DAMAGED", label: "Damaged" },
  { value: "EXPIRED", label: "Expired" },
] as const;

export const RELEASE_REASON_OPTIONS = [
  { value: "DISCHARGED", label: "Discharged" },
  { value: "DECEASED", label: "Deceased" },
  { value: "NO_LONGER_REQUIRED", label: "No longer required" },
  { value: "WRONG_ALLOCATION", label: "Wrong allocation" },
] as const;

export const ADJUSTMENT_REASON_OPTIONS = [
  { value: "COUNT_VARIANCE", label: "Count variance" },
  { value: "FOUND", label: "Found" },
  { value: "LOST", label: "Lost" },
  { value: "DAMAGED", label: "Damaged" },
  { value: "EXPIRED", label: "Expired" },
  { value: "TRANSFER_DISCREPANCY", label: "Transfer discrepancy" },
  { value: "DATA_ENTRY", label: "Data entry error" },
  { value: "OTHER", label: "Other" },
] as const;

export const REVERSE_REASON_OPTIONS = [
  { value: "DATA_ENTRY", label: "Data entry error" },
  { value: "WRONG_RESIDENT", label: "Wrong resident" },
  { value: "WRONG_PRODUCT", label: "Wrong product" },
  { value: "WRONG_QTY", label: "Wrong quantity" },
  { value: "WRONG_COST", label: "Wrong cost" },
  { value: "OTHER", label: "Other" },
] as const;

export const CANCEL_TRANSFER_REASON_OPTIONS = [
  { value: "DATA_ENTRY", label: "Data entry error" },
  { value: "WRONG_PRODUCT", label: "Wrong product" },
  { value: "WRONG_QTY", label: "Wrong quantity" },
  { value: "OTHER", label: "Other" },
] as const;

export const TXN_TYPE_LABELS: Record<string, string> = {
  OPENING_BALANCE: "Opening balance",
  RECEIPT: "Receipt",
  ISSUE: "Issue",
  INTERNAL_TRANSFER: "Store ↔ Floor",
  TRANSIT_ALLOCATE: "Allocate to Transit",
  TRANSIT_RELEASE: "Release from Transit",
  BRANCH_TRANSFER_OUT: "Branch transfer out",
  BRANCH_TRANSFER_IN: "Branch transfer in",
  RETURN_FROM_ISSUE: "Return from issue",
  RETURN_TO_SUPPLIER: "Return to supplier",
  DAMAGED_EXPIRED: "Write-off",
  ADJUSTMENT: "Adjustment",
  REVERSAL: "Reversal",
};

export const ADJUSTMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export const REQUEST_STATUS_OPTIONS = [
  { value: "DRAFT", label: "Draft" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "ORDERED", label: "Ordered" },
  { value: "PARTIALLY_RECEIVED", label: "Partially received" },
  { value: "RECEIVED", label: "Received" },
  { value: "CLOSED", label: "Closed" },
  { value: "CANCELLED", label: "Cancelled" },
] as const;

/** Statuses a delivery can still be received against (schema/017). */
export const REQUEST_RECEIVABLE_STATUSES: readonly string[] = ["APPROVED", "ORDERED", "PARTIALLY_RECEIVED"];

export const REQUEST_EVENT_LABELS: Record<string, string> = {
  CREATED: "Created",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ORDERED: "Ordered",
  FOLLOW_UP: "Follow-up",
  RECEIPT_LINKED: "Delivery received",
  LINE_CLOSED_SHORT: "Line closed short",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

// ----------------------------------------------------------------- stock counts (schema/018)

export const COUNT_STATUS_OPTIONS = [
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "SUBMITTED", label: "Awaiting review" },
  { value: "CLOSED", label: "Closed" },
  { value: "CANCELLED", label: "Cancelled" },
] as const;

export const COUNT_TYPE_OPTIONS = [
  { value: "MONTHLY_STORE", label: "Monthly Store count" },
  { value: "WEEKLY_FLOOR", label: "Weekly Floor count" },
  { value: "AD_HOC", label: "Ad hoc count" },
] as const;

/** Q-30: a monthly Store count freezes its location by default; the others do not. */
export function defaultFreeze(countType: string): boolean {
  return countType === "MONTHLY_STORE";
}

export type InvCountRow = {
  id: number;
  countNo: string;
  status: string;
  countType: string;
  locationId: number;
  freezeLocation: boolean;
  countedByStaff: string;
  startedAt: string | null;
  submittedAt: string | null;
  closedAt: string | null;
  lineCount: number;
};
export type InvCountHeader = InvCountRow & { investigatedByStaff: string | null; investigationSummary: string | null };
/** One count-sheet line as the pages show it; expected/variance stay null while the count is blind. */
export type InvCountLineView = {
  id: number;
  productId: number;
  name: string;
  sku: string;
  uomCode: string;
  allowFraction: boolean;
  residentName: string | null;
  isFound: boolean;
  physical: number | null;
  expected: number | null;
  postedSince: number | null;
  variance: number | null;
  note: string | null;
};
export type InvCountAdjustment = { id: number; adjustmentNo: string; status: string };

/** A base-unit qty expressed in another unit, e.g. 250 EA with BOX = 100 → 2.5. */
export function toPurchaseQty(base: number, factor: number): number {
  return factor > 0 ? Math.round((base / factor) * 10000) / 10000 : base;
}

export function labelOf(options: readonly { value: string; label: string }[], value: string | null | undefined): string {
  return options.find((o) => o.value === value)?.label ?? value ?? "";
}

// ----------------------------------------------------------------- RPC codes → messages

const CODE_MESSAGES: Record<string, string> = {
  FORBIDDEN: "You are not allowed to do this here.",
  NOT_AUTHENTICATED: "Your session has expired. Please sign in again.",
  RPC_ERROR: "Something went wrong. Nothing was saved. Please try again.",
  INVALID_PAYLOAD: "Some details are missing or invalid.",
  IDEMPOTENCY_KEY_REUSED: "This form was already submitted with different details. Please submit again.",
  INVENTORY_NOT_ENABLED: "Inventory is not enabled for this branch yet.",
  INVALID_DATE: "Please enter a valid date.",
  DATE_IN_FUTURE: "The date cannot be in the future.",
  DATE_BEFORE_GO_LIVE: "The date is before this branch went live on Inventory.",
  DATE_BEFORE_ORIGINAL: "The date cannot be before the original transaction.",
  DATE_BEFORE_DISPATCH: "The date cannot be before the dispatch.",
  PERIOD_LOCKED: "That month is locked.",
  LATER_PERIOD_LOCKED: "A later month is already locked.",
  PRODUCT_NOT_FOUND: "Product not found.",
  PRODUCT_INACTIVE: "This product is inactive.",
  NOT_STOCK_ITEM: "Service items are not stock items.",
  UOM_NOT_CONVERTIBLE: "This unit is not set up for the product.",
  INVALID_QTY: "Please enter a valid quantity.",
  QTY_NOT_INTEGRAL: "This unit only allows whole numbers.",
  QTY_TOO_LARGE: "The quantity is too large.",
  STAFF_REQUIRED: "Please choose who performed this.",
  STAFF_NOT_FOUND: "Staff member not found.",
  STAFF_INACTIVE: "This staff member is not active.",
  STAFF_WRONG_BRANCH: "This staff member does not belong to this branch.",
  STAFF_NOT_SENIOR: "This action must be performed by a Head Nurse, Assist. Head Nurse or Nursing Director.",
  LOCATION_INACTIVE: "This location is inactive.",
  LOCATION_COUNT_IN_PROGRESS: "A stock count is in progress at this location.",
  LOCATION_NOT_STORE: "This can only be done in the Store.",
  TRANSIT_NEGATIVE: "Transit stock cannot go below zero.",
  TRANSIT_STOCK_USED: "Stock allocated from this receipt has already been used; reverse that movement first.",
  NEGATIVE_STOCK_CONFIRM: "Stock would go below zero. Confirm to continue.",
  SANITY_CONFIRM: "Some lines look unusually large. Please re-check them.",
  INACTIVE_RESIDENT_CONFIRM: "The resident is not active. Confirm to continue.",
  MIXED_BRANCHES: "All lines must be from the same branch.",
  INVALID_TARGET: "Please choose who this is for.",
  INVALID_DESTINATION: "Invalid destination branch.",
  RESIDENT_NOT_FOUND: "Please choose a resident.",
  RESIDENT_WRONG_BRANCH: "The resident is not in this branch.",
  RESIDENT_NOT_ACTIVE: "The resident is not active.",
  TRANSIT_ISSUE_RESIDENT_ONLY: "Transit stock can only be issued to its own resident.",
  NOT_CHARGEABLE: "This product cannot be charged to a resident.",
  DUPLICATE_LINE: "The same product appears twice. Merge the lines.",
  INVALID_LOCATIONS: "These locations cannot be used for this movement.",
  INVALID_REASON: "Please choose a reason.",
  INVALID_DOC_TYPE: "Please choose the document type.",
  INVOICE_REQUIRED: "The invoice number is required.",
  INVALID_INVOICE_DATE: "Please enter a valid invoice date.",
  INVALID_TOTALS: "Please check the invoice totals.",
  SUPPLIER_NOT_FOUND: "Please choose a supplier.",
  SUPPLIER_INACTIVE: "This supplier is inactive.",
  INVALID_COST: "Please enter a valid cost.",
  COST_TOO_LARGE: "The cost is too large.",
  EXTRA_WITHOUT_LINE_VALUE: "Charges and tax need at least one priced line.",
  NEGATIVE_LANDED_COST: "The discount is larger than the line value.",
  DUPLICATE_INVOICE: "This invoice has already been received.",
  TRANSIT_LOCATION_MISSING: "This branch has no Transit location.",
  CANNOT_REVERSE_REVERSAL: "A reversal cannot be reversed.",
  ALREADY_REVERSED: "This transaction has already been reversed.",
  USE_CANCEL_TRANSFER: "Cancel the branch transfer instead.",
  USE_TXN_REVERSAL: "Reverse the transaction instead.",
  TRANSFER_STATE_MISMATCH: "The transfer is no longer in that state.",
  TRANSFER_NOT_FOUND: "Transfer not found.",
  TRANSFER_NOT_DISPATCHED: "The transfer is no longer awaiting receipt.",
  TRANSFER_NOT_CANCELLABLE: "This transfer can no longer be cancelled.",
  PRODUCT_NOT_AT_DESTINATION: "A product on this transfer is not available at the destination.",
  RECEIPT_NOT_FOUND: "Receipt not found for this supplier.",
  RECEIPT_VOIDED: "This receipt was voided.",
  RECEIPT_HAS_ALLOCATION: "This receipt allocated stock to a resident; reverse it instead.",
  PRODUCT_NOT_ON_RECEIPT: "A product is not on the selected receipt.",
  ISSUE_LINE_NOT_FOUND: "Issue not found.",
  ISSUE_REVERSED: "That issue has been reversed.",
  ISSUE_HAS_RETURNS: "This issue has returns. Reverse the returns first.",
  RETURN_EXCEEDS_ISSUED: "You cannot return more than was issued.",
  OPENING_WINDOW_CLOSED: "The opening-balance window for this branch is closed.",
  OPENING_POOL_HAS_ACTIVITY: "This product already has movements; use an adjustment instead.",
  JUSTIFICATION_REQUIRED: "Please explain the adjustment (at least 5 characters).",
  ADJUSTMENT_NOT_PENDING: "This adjustment has already been decided.",
  SOD_SAME_ACCOUNT: "Another login must approve this request.",
  SOD_SAME_STAFF: "The approver must be a different person from the requester.",
  WRITE_OFF_NEEDS_APPROVAL: "This write-off needs approval. Request an adjustment instead.",
  INVALID_SKU: "The SKU may use letters, digits, dot, dash and underscore (max 40).",
  INVALID_NAME: "Please check the name and text fields.",
  INVALID_NUMBER: "Please check the numbers.",
  CATEGORY_NOT_FOUND: "Please choose a category.",
  SERVICE_HAS_NO_MAX: "Service items have no max level.",
  UOM_NOT_FOUND: "Please choose valid units.",
  UOM_FACTOR_INVALID: "Each extra unit must contain more than 1 base unit.",
  UOM_FACTOR_LOCKED: "This unit's conversion is already in use and cannot change. Add a new unit instead.",
  UOM_HAS_BARCODES: "A unit you removed still has barcodes. Deactivate them first.",
  PURCHASE_UOM_MISSING: "The purchase unit needs a conversion.",
  BASE_UOM_LOCKED: "The base unit cannot change once the product has been used.",
  STOCK_FLAG_LOCKED: "A used product cannot move between stock and service categories.",
  SKU_EXISTS: "This SKU already exists.",
  SUPPLIER_EXISTS: "A supplier with this name already exists.",
  INVALID_BARCODE: "Invalid barcode.",
  BARCODE_IN_USE: "This barcode is already used by another product.",
  ALREADY_INACTIVE: "Already inactive.",
  REQUEST_NOT_FOUND: "Stock request not found for this branch.",
  REQUEST_BAD_STATUS: "The request is no longer in a state that allows this.",
  REQUEST_NOT_RECEIVABLE: "This request is not approved or is already complete.",
  REQUEST_NO_MATCHING_LINE: "None of these products is on the selected request.",
  REQUEST_LINE_NOT_FOUND: "Request line not found.",
  NOTHING_APPROVED: "Approve at least one line, or reject the request.",
  LINE_ALREADY_CLOSED: "This line is already closed.",
  NOTE_REQUIRED: "Please add a note.",
  INVALID_REF: "The order reference is too long (max 60 characters).",
  COUNT_IN_PROGRESS: "A count at this location is still in progress or waiting for review.",
  COUNT_ADJUSTMENT_PENDING: "The last count's adjustment at this location is still waiting for approval.",
  COUNT_BAD_STATUS: "The count is no longer in a state that allows this.",
  COUNT_INCOMPLETE: "Every line must be counted before the count can be submitted.",
  COUNT_EMPTY: "This count has no lines.",
  COUNT_LINE_NOT_FOUND: "Count line not found.",
  INVALID_COUNT_TYPE: "Please choose the count type.",
};

/** English message key (translated by the caller with t()). */
export function messageForCode(code: string): string {
  return CODE_MESSAGES[code] ?? CODE_MESSAGES.RPC_ERROR;
}

// ----------------------------------------------------------------- barcodes (D-128)

/** Lookup variants: exact, then UPC-A ↔ EAN-13 (add or drop a leading 0). */
export function barcodeVariants(raw: string): string[] {
  const code = raw.trim();
  if (/^\d{12}$/.test(code)) return [code, `0${code}`];
  if (/^0\d{12}$/.test(code)) return [code, code.slice(1)];
  return [code];
}

export function findBarcode(barcodes: InvBarcode[], raw: string): InvBarcode | null {
  const variants = barcodeVariants(raw);
  for (const v of variants) {
    const hit = barcodes.find((b) => b.barcode === v);
    if (hit) return hit;
  }
  return null;
}

export function isSeniorPosition(position: string | null | undefined, role: string | null | undefined): boolean {
  return ["Head Nurse", "Assist. Head Nurse", "Nursing Director"].includes(position ?? "") || role === "ADMIN";
}

export function uomLabel(uoms: InvUom[], id: number): string {
  return uoms.find((u) => u.id === id)?.code ?? "";
}

export function productUoms(product: InvProduct | undefined): InvProductUom[] {
  return (product?.uoms ?? []).filter((u) => u.isActive);
}

/** Qty inputs reject more than 7 integer digits (D-109). */
export function parseQty(value: string): number | null {
  const v = value.trim();
  if (!/^\d{1,7}(\.\d{1,4})?$/.test(v)) return null;
  const n = Number(v);
  return n > 0 ? n : null;
}

export function parseMoney(value: string, allowEmpty = true): number | null | undefined {
  const v = value.trim();
  if (v === "") return allowEmpty ? null : undefined;
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(v)) return undefined;
  return Number(v);
}

export function todayKL(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date());
}

/** The KL calendar date `days` days before today (YYYY-MM-DD). */
export function daysAgoKL(days: number): string {
  const d = new Date(`${todayKL()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function formatQty(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return Number(n).toLocaleString("en-MY", { maximumFractionDigits: 4 });
}

export function formatMoney(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined) return "";
  return Number(n).toLocaleString("en-MY", { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 2) });
}
