import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";
import {
  CallbellTabs,
  type CallLogRow,
  type KnownDevice,
  type ReceiverRow,
  type ResidentOption,
} from "./callbell-tabs";

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

function fmtResponseDuration(
  callTimeMs: string | number | null,
  responseTimeMs: string | number | null
): string {
  const ct = callTimeMs ? Number(callTimeMs) : 0;
  const rt = responseTimeMs ? Number(responseTimeMs) : 0;
  if (!ct || !rt || rt <= ct) return "—";
  const totalSec = Math.round((rt - ct) / 1000);
  if (totalSec <= 0) return "—";
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

export default async function CallbellPage() {
  const { t } = await getServerTranslator();
  const account = await getCurrentUser();
  const adminClient = createAdminClient();

  // ── Receivers scoped to branch (or all branches for HQ/admin) ──
  type ReceiverDbRow = { id: number; branch_id: number; receiver_label: string; android_id: string | null; apk_version: string | null; last_seen_at: string | null };
  let receiversQuery = adminClient
    .from("cb_receivers")
    .select("id, branch_id, receiver_label, android_id, apk_version, last_seen_at")
    .order("receiver_label");

  if (account && !canAccessAllBranches(account)) {
    receiversQuery = receiversQuery.eq("branch_id", account.branch_id);
  }

  const { data: receiverRows } = await receiversQuery;
  const receiverList = (receiverRows ?? []) as ReceiverDbRow[];
  const receiverIds = receiverList.map((r) => r.id);
  const branchIds = [...new Set(receiverList.map((r) => r.branch_id))];
  const receiverLabelById = Object.fromEntries(receiverList.map((r) => [r.id, r.receiver_label]));

  if (receiverIds.length === 0) {
    return (
      <div>
        <PageTitle title={t("Call Bell")} />
        <p className="mt-6 text-sm text-fg-faint">{t("No receivers found.")}</p>
      </div>
    );
  }

  // ── All data in parallel ──
  const [logsResult, assignmentsResult, deviceLogsResult, residentsResult] = await Promise.all([
    adminClient
      .from("cb_call_logs")
      .select("id, receiver_id, device_num, resident_name_snapshot, call_type, call_time, response_time")
      .in("receiver_id", receiverIds)
      .order("call_time", { ascending: false, nullsFirst: false })
      .limit(200),

    adminClient
      .from("cb_assignments")
      .select("id, receiver_id, device_num, resident_id, room_label, tbl_residents(resident_name)")
      .in("receiver_id", receiverIds)
      .order("device_num"),

    // Distinct devices via call logs — deduplicated in JS below
    adminClient
      .from("cb_call_logs")
      .select("receiver_id, device_num")
      .in("receiver_id", receiverIds)
      .order("device_num")
      .limit(2000),

    adminClient
      .from("tbl_residents")
      .select("id, resident_name")
      .in("branch_id", branchIds)
      .eq("status", "ACTIVE")
      .order("resident_name"),
  ]);

  // ── Map: "{receiver_id}:{device_num}" -> assignment row ──
  type AssignmentDbRow = { id: number; receiver_id: number; device_num: string; resident_id: number | null; room_label: string | null; tbl_residents: { resident_name: string } | { resident_name: string }[] | null };
  const assignmentMap = new Map<string, AssignmentDbRow>();
  for (const row of (assignmentsResult.data ?? []) as AssignmentDbRow[]) {
    assignmentMap.set(`${row.receiver_id}:${row.device_num}`, row);
  }

  // ── Deduplicated known devices ──
  const seenDevices = new Set<string>();
  const devices: KnownDevice[] = [];
  for (const row of (deviceLogsResult.data ?? []) as { receiver_id: number; device_num: string }[]) {
    const key = `${row.receiver_id}:${row.device_num}`;
    if (seenDevices.has(key)) continue;
    seenDevices.add(key);
    const asgn = assignmentMap.get(key);
    const res = asgn
      ? (Array.isArray(asgn.tbl_residents) ? asgn.tbl_residents[0] : asgn.tbl_residents)
      : null;
    devices.push({
      receiver_id: row.receiver_id,
      receiver_label: receiverLabelById[row.receiver_id] ?? "—",
      device_num: row.device_num,
      assignment_id: asgn?.id ?? null,
      resident_id: asgn?.resident_id ?? null,
      resident_name: res?.resident_name ?? "",
      room_label: asgn?.room_label ?? "",
    });
  }

  // ── Call logs ──
  const logs: CallLogRow[] = (logsResult.data ?? []).map((row) => ({
    id: row.id as number,
    receiver_label: receiverLabelById[row.receiver_id as number] ?? "—",
    device_num: (row.device_num as string) ?? "",
    resident_name: (row.resident_name_snapshot as string) ?? "",
    call_type: (row.call_type as string) ?? "",
    call_time_display: fmtCallTime(row.call_time as string | number | null),
    response_time_display: fmtResponseDuration(
      row.call_time as string | number | null,
      row.response_time as string | number | null
    ),
  }));

  // ── Receivers display ──
  const receivers: ReceiverRow[] = receiverList.map((row) => ({
    id: row.id,
    receiver_label: row.receiver_label,
    android_id: row.android_id ?? "",
    apk_version: row.apk_version ?? "",
    last_seen_display: fmtLastSeen(row.last_seen_at),
  }));

  // ── Residents picker options ──
  const residents: ResidentOption[] = (residentsResult.data ?? []).map((r) => ({
    id: r.id as number,
    resident_name: (r.resident_name as string) ?? "",
  }));

  return (
    <div>
      <PageTitle title={t("Call Bell")} />
      <CallbellTabs
        logs={logs}
        devices={devices}
        receivers={receivers}
        residents={residents}
      />
    </div>
  );
}
