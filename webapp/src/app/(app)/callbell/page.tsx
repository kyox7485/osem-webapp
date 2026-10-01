import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";
import { CallbellTabs, type CallLogRow, type AssignmentRow, type ReceiverRow } from "./callbell-tabs";

const TZ = "Asia/Kuala_Lumpur";

function fmtCallTime(ms: string | number | null): string {
  const n = ms ? Number(ms) : 0;
  if (!n || n <= 0) return "—";
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(n));
}

function fmtLastSeen(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function fmtResponseTime(val: string | number | null): string {
  const n = val ? Number(val) : 0;
  if (!n || n <= 0) return "—";
  return `${n}s`;
}

export default async function CallbellPage() {
  const { t } = await getServerTranslator();
  const supabase = await createClient();

  const [logsResult, assignmentsResult, receiversResult] = await Promise.all([
    supabase
      .from("cb_call_logs")
      .select("id, device_num, resident_name_snapshot, call_type, call_time, response_time, duration, cb_receivers(receiver_label)")
      .order("call_time", { ascending: false, nullsFirst: false })
      .limit(200),

    supabase
      .from("cb_assignments")
      .select("id, device_num, room_label, cb_receivers(receiver_label), tbl_residents(resident_name)")
      .order("device_num"),

    supabase
      .from("cb_receivers")
      .select("id, receiver_label, android_id, apk_version, last_seen_at")
      .order("receiver_label"),
  ]);

  const logs: CallLogRow[] = (logsResult.data ?? []).map((row) => {
    const rec = Array.isArray(row.cb_receivers) ? row.cb_receivers[0] : row.cb_receivers;
    return {
      id: row.id,
      receiver_label: rec?.receiver_label ?? "—",
      device_num: row.device_num ?? "",
      resident_name: row.resident_name_snapshot ?? "",
      call_type: row.call_type ?? "",
      call_time_display: fmtCallTime(row.call_time),
      response_time_display: fmtResponseTime(row.response_time),
      duration: row.duration ?? "",
    };
  });

  const assignments: AssignmentRow[] = (assignmentsResult.data ?? []).map((row) => {
    const rec = Array.isArray(row.cb_receivers) ? row.cb_receivers[0] : row.cb_receivers;
    const res = Array.isArray(row.tbl_residents) ? row.tbl_residents[0] : row.tbl_residents;
    return {
      id: row.id,
      receiver_label: rec?.receiver_label ?? "—",
      device_num: row.device_num ?? "",
      resident_name: (res as { resident_name?: string } | null)?.resident_name ?? "",
      room_label: row.room_label ?? "",
    };
  });

  const receivers: ReceiverRow[] = (receiversResult.data ?? []).map((row) => ({
    id: row.id,
    receiver_label: row.receiver_label,
    android_id: row.android_id ?? "",
    apk_version: row.apk_version ?? "",
    last_seen_display: fmtLastSeen(row.last_seen_at),
  }));

  return (
    <div>
      <PageTitle title={t("Call Bell")} />
      <CallbellTabs logs={logs} assignments={assignments} receivers={receivers} />
    </div>
  );
}
