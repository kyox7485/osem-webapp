// Server-side bridge to the medication-orders Google Apps Script Web App.
// Required env vars (server-only, never NEXT_PUBLIC_):
//   MEDICATION_ORDER_SCRIPT_URL    -- the deployed /exec URL
//   MEDICATION_ORDER_SCRIPT_SECRET -- shared secret matching the Apps Script constant
//
// Pattern mirrors google-drive.ts: fetch with retry for Apps Script flakiness.

export function isMedicationScriptConfigured(): boolean {
  return Boolean(
    process.env.MEDICATION_ORDER_SCRIPT_URL &&
      process.env.MEDICATION_ORDER_SCRIPT_SECRET
  );
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// The Apps Script response has two independent layers:
//   success       -- did the Google Sheet write succeed? (the source of truth)
//   supabaseSync  -- did the row also mirror to Supabase + rebuild the
//                    resident's current_medication_list? Can fail on its own
//                    (transient network blip) without the sheet write failing.
// A supabaseSync failure does NOT throw here — the order is already durably
// recorded in the Sheet, and Apps Script's 1-minute heartbeat / 24h
// reconciliation triggers retry it automatically. It is logged loudly so a
// stuck sync is still visible in Vercel logs instead of disappearing.
type MedicationScriptResponse = {
  success: boolean;
  error?: string;
  // Only present on "update" — an edit never overwrites the order in place;
  // it discontinues the old row and appends a new one with this RxOrderID.
  newRxOrderId?: string;
  supabaseSync?: {
    success: boolean;
    error?: string;
    [key: string]: unknown;
  };
  previousOrderSync?: {
    success: boolean;
    error?: string;
    [key: string]: unknown;
  };
};

async function callScript(
  payload: Record<string, unknown>,
  attempt = 1
): Promise<MedicationScriptResponse> {
  if (!isMedicationScriptConfigured()) {
    throw new Error(
      "Medication order script not configured (missing MEDICATION_ORDER_SCRIPT_URL or MEDICATION_ORDER_SCRIPT_SECRET)"
    );
  }

  const res = await fetch(process.env.MEDICATION_ORDER_SCRIPT_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      secret: process.env.MEDICATION_ORDER_SCRIPT_SECRET,
    }),
    redirect: "follow", // Apps Script /exec URLs 302 once before executing
  });

  if (!res.ok) {
    if (attempt < 3) {
      await sleep(500 * attempt);
      return callScript(payload, attempt + 1);
    }
    throw new Error(`Apps Script HTTP ${res.status}`);
  }

  const json = (await res.json()) as MedicationScriptResponse;
  if (!json.success) throw new Error(json.error || "Apps Script request failed");

  if (json.supabaseSync && json.supabaseSync.success === false) {
    console.error(
      "Medication order saved to Google Sheet, but Supabase sync failed " +
        "(Apps Script's 1-minute heartbeat / 24h reconciliation will retry " +
        "automatically):",
      json.supabaseSync.error
    );
  }

  if (json.previousOrderSync && json.previousOrderSync.success === false) {
    console.error(
      "Old order row was discontinued in the Google Sheet, but syncing " +
        "that status change to Supabase failed (will retry automatically):",
      json.previousOrderSync.error
    );
  }

  return json;
}

// Fields sent to the sheet — exact column names from the spec.
export type MedicationOrderSheetFields = {
  RxOrderID: string;
  ResidentID: string;
  "Dosage Form": string;
  "Brand Name": string;
  "Active Ingredient": string;
  Dose: string;
  Unit: string;
  Frequency: string;
  "Administration Times": string;
  "Dosing Days": string;
  Indication: string;
  Instruction: string;
  "Duration Type": string;
  "Start Date": string; // YYYY-MM-DD — Apps Script reformats to DD/MM/YYYY for the sheet
  "End Date": string; // YYYY-MM-DD or "" — same reformatting
  "Noted By": string; // internal staff's StaffID, or a free-text name typed via "Others"
  "Ordered By": string;
  "Supplied By": string;
  Status: string;
  PreviousRxOrderID: string;
};

export async function createMedicationOrder(
  order: MedicationOrderSheetFields
): Promise<MedicationScriptResponse> {
  return callScript({ action: "create", order });
}

// An "edit" never overwrites the order in place (see medication-orders.gs's
// updateOrder). rxOrderId identifies the OLD row to discontinue; `order`
// describes the brand-new revision row, including its own new RxOrderID and
// PreviousRxOrderID = rxOrderId.
export async function updateMedicationOrder(
  rxOrderId: string,
  order: MedicationOrderSheetFields
): Promise<MedicationScriptResponse> {
  return callScript({ action: "update", rxOrderId, order });
}

// Changes only the Status of existing rows, Sheet first (medication-orders.gs
// setOrderStatus), then the normal targeted Supabase sync + summary rebuild.
// Used by Discontinue and end-date auto-expiry so the Sheet/AppSheet never
// disagree with Supabase. `notFound` lists ids that are not in the Sheet.
export async function setMedicationOrderStatus(
  rxOrderIds: string[],
  status: "Active" | "Discontinued"
): Promise<MedicationScriptResponse & { updated?: string[]; notFound?: string[] }> {
  return callScript({ action: "setOrderStatus", rxOrderIds, status }) as Promise<
    MedicationScriptResponse & { updated?: string[]; notFound?: string[] }
  >;
}

// One row of the Google Sheet tab tbl_MedicationStock — exact column names.
export type MedicationStockSheetFields = {
  StockID: string;
  ResidentID: string; // Google-format ResidentID, e.g. BMN-0002
  RxOrderID: string; // the EXACT order revision
  Balance: number; // resulting balance after the event
  Unit: string;
  "Daily Usage": number; // snapshot at event time; 0 = not applicable
  "Days Remaining": number; // snapshot at event time; 0 = not applicable
  StockDate: string; // DD/MM/YYYY HH:mm:ss, Asia/Kuala_Lumpur
  RegisteredBy: string; // tbl_staff.StaffID
  EntryType: "Stock Count" | "Stock Received" | "Order Changed";
};

// Appends one stock event (MedicationStock.gs createStockEntry). Idempotent
// on StockID, so callScript's HTTP retries cannot create duplicates.
export async function createMedicationStockEntry(
  entry: MedicationStockSheetFields
): Promise<MedicationScriptResponse> {
  return callScript({ action: "stockCreate", entry });
}

// One row of the consumables spreadsheet tab tbl_ResidentConsumable — exact
// column names. Same Apps Script project ("Sync to Supabase"), which opens the
// consumables spreadsheet by ID (Consumables.gs).
export type ConsumableCountSheetFields = {
  RecordID: string;
  ResidentID: string; // Supabase form, e.g. AMN-0138 (the sync pads either form)
  ConsumableID: string;
  OtherConsumable: string; // "" unless the catalogue's "Other" item
  OtherUnit: string;
  Supplier: "Family" | "OSEM";
  CurrentStock: number;
  LastCount: string; // DD/MM/YYYY HH:mm:ss, Asia/Kuala_Lumpur
  CountedBy: string; // tbl_staff.StaffID
};

// Appends one weekly count (several items) in one call. Idempotent on
// RecordID, so callScript's HTTP retries cannot create duplicates.
export async function createConsumableCounts(
  entries: ConsumableCountSheetFields[]
): Promise<MedicationScriptResponse> {
  return callScript({ action: "consumableCountCreate", entries });
}
