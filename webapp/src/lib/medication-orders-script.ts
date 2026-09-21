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
