import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import {
  loadAdmissionMedicationQueue,
  processNextAdmissionMedication,
  retryAdmissionMedication,
} from "@/lib/admission-medication-queue";
import type { AdmissionMedQueueResponse } from "@/lib/admission-medication-queue-types";

/**
 * Background queue for New Resident admission medications
 * (schema/023_admission_medication_queue.sql, lib/admission-medication-queue.ts).
 *
 *   POST { action: "process", residentId }  → create ONE queued order (+ initial stock)
 *   POST { action: "retry", queueId }       → put a failed row back in the queue
 *
 * A Route Handler, not a Server Action, on purpose: Next.js runs a tab's
 * Server Actions one at a time and discards a pending one's result on
 * navigation, so a ~1-minute Apps Script call made as a Server Action would
 * hold up every save the nurse makes meanwhile. Plain fetch() calls don't
 * queue behind each other and survive client-side navigation.
 *
 * Scope: every query uses the caller's RLS-scoped client, and the resident
 * must be visible to the caller (branch scope + DEMO isolation via RLS).
 */
export const maxDuration = 300;

async function visibleResident(supabase: Awaited<ReturnType<typeof createClient>>, residentId: number) {
  const { data } = await supabase.from("tbl_residents").select("id").eq("id", residentId).maybeSingle();
  return Boolean(data);
}

export async function POST(request: NextRequest) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { action?: unknown; residentId?: unknown; queueId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = await createClient();

  if (body.action === "retry") {
    const queueId = Number(body.queueId);
    if (!Number.isInteger(queueId) || queueId <= 0) {
      return NextResponse.json({ error: "queueId required" }, { status: 400 });
    }
    const residentId = await retryAdmissionMedication(supabase, queueId);
    if (residentId === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const res: AdmissionMedQueueResponse = {
      residentId,
      items: await loadAdmissionMedicationQueue(supabase, residentId),
    };
    return NextResponse.json(res);
  }

  if (body.action === "process") {
    const residentId = Number(body.residentId);
    if (!Number.isInteger(residentId) || residentId <= 0) {
      return NextResponse.json({ error: "residentId required" }, { status: 400 });
    }
    if (!(await visibleResident(supabase, residentId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const processed = await processNextAdmissionMedication(supabase, residentId);
    const res: AdmissionMedQueueResponse = {
      residentId,
      processed,
      items: await loadAdmissionMedicationQueue(supabase, residentId),
    };
    return NextResponse.json(res);
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
