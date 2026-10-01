// Shapes shared by the admission-medication queue's API route and its client
// runner/status card. Kept free of server imports so "use client" files can
// import it (see the lookups.ts footgun in CLAUDE.md).

export type AdmissionMedQueueStatus = "pending" | "processing" | "done" | "failed";
export type AdmissionMedStockStatus = "not_needed" | "pending" | "done" | "failed";

export type AdmissionMedQueueItem = {
  id: number;
  position: number;
  rxOrderId: string;
  label: string;
  status: AdmissionMedQueueStatus;
  orderDone: boolean;
  stockStatus: AdmissionMedStockStatus;
  lastError: string | null;
};

export type AdmissionMedQueueResponse = {
  residentId: number;
  items: AdmissionMedQueueItem[];
  // True when this request processed a row; false means nothing was left to
  // claim (all done/failed, or another tab is working on the rest).
  processed?: boolean;
  error?: string;
};

export const ADMISSION_MED_QUEUE_API = "/api/residents/admission-medications";

// An open row (pending, or processing in some tab) still needs work.
export function hasOpenItems(items: AdmissionMedQueueItem[]): boolean {
  return items.some((i) => i.status === "pending" || i.status === "processing");
}
