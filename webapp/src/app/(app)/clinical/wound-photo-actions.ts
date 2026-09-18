"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { revalidatePath } from "next/cache";

export type WoundPhoto = {
  id: number;
  body_part_label: string;
  description: string | null;
  uploaded_at: string;
};

export type WoundSession = {
  id: number;
  resident_id: number;
  session_started_at: string;
  completed_at: string | null;
  tbl_residents: { id: number; resident_name: string; branch_id: number } | null;
  uploader: { StaffID: string; staff_name: string } | null;
  photos: WoundPhoto[];
};

export async function getWoundSessionHistory(filters: {
  residentId?: string;
  start?: string;
  end?: string;
}): Promise<{ sessions: WoundSession[]; error: string | null }> {
  const account = await getCurrentUser();
  if (!account) return { sessions: [], error: "Not authenticated" };

  const supabase = await createClient();
  let query = supabase
    .from("tbl_wound_sessions")
    .select(
      `
      id,
      resident_id,
      session_started_at,
      completed_at,
      tbl_residents!resident_id(id, resident_name, branch_id),
      uploader:tbl_staff!uploaded_by(StaffID, staff_name),
      photos:tbl_wound_photos(id, body_part_label, description, uploaded_at)
    `
    )
    .order("session_started_at", { ascending: false });

  if (account.rights !== "ADMIN") query = query.eq("branch_id", account.branch_id);
  if (filters.residentId) query = query.eq("resident_id", parseInt(filters.residentId));
  if (filters.start) query = query.gte("session_started_at", `${filters.start}T00:00:00`);
  if (filters.end) query = query.lte("session_started_at", `${filters.end}T23:59:59`);

  const { data, error } = await query;

  const sessions = (data ?? []).map((s: any) => ({
    ...s,
    tbl_residents: Array.isArray(s.tbl_residents) ? s.tbl_residents[0] : s.tbl_residents,
    uploader: Array.isArray(s.uploader) ? s.uploader[0] : s.uploader,
    photos: (s.photos ?? []) as WoundPhoto[],
  }));

  return { sessions, error: error?.message || null };
}

// "Uploaded by" is deliberately not asked for until this point -- staff
// can start taking and saving photos immediately, and only need to say
// who they are once, at the end of the session, rather than before every
// photo. Individual photos may have been inserted with uploaded_by = null
// while the session was in progress (see the /api/wound-photos route), so
// finishing backfills it onto every photo in the session as well as the
// session row itself, keeping the per-photo record complete.
//
// Otherwise purely a display/reporting marker -- staff can keep adding
// photos to a session in the same browser visit regardless of this flag;
// it just records when they tapped "Finish" so the history view can show
// a session's end time, not a hard lock on further inserts.
export async function finishWoundSession(sessionId: number, uploadedBy: string): Promise<{ success: boolean; error?: string }> {
  const account = await getCurrentUser();
  if (!account) return { success: false, error: "Not authenticated" };
  if (!uploadedBy) return { success: false, error: "Please select who uploaded these photos" };

  const supabase = await createClient();
  const { error: sessionError } = await supabase
    .from("tbl_wound_sessions")
    .update({ uploaded_by: uploadedBy, completed_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (sessionError) return { success: false, error: sessionError.message };

  const { error: photosError } = await supabase.from("tbl_wound_photos").update({ uploaded_by: uploadedBy }).eq("session_id", sessionId);
  if (photosError) return { success: false, error: photosError.message };

  revalidatePath("/clinical");
  return { success: true };
}
