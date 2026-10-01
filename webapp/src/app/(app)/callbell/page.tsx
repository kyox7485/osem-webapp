import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";
import { formatBranch } from "@/lib/lookups";
import {
  CallbellTabs,
  type CallLogRow,
  type BellDevice,
  type BranchOption,
  type ReceiverRow,
  type ResidentOption,
} from "./callbell-tabs";
import { CallbellBranchPicker } from "./branch-picker";

const TZ = "Asia/Kuala_Lumpur";
const SLOW_RESPONSE_MS = 15 * 60_000; // response slower than 15 min is flagged red

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

export default async function CallbellPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const { branch } = await searchParams;
  const { t } = await getServerTranslator();
  const account = await getCurrentUser();
  const adminClient = createAdminClient();

  // ── Receivers the account may see (all branches for HQ/admin) ──
  type ReceiverDbRow = { id: number; branch_id: number; receiver_label: string; android_id: string | null; apk_version: string | null; last_seen_at: string | null };
  let receiversQuery = adminClient
    .from("cb_receivers")
    .select("id, branch_id, receiver_label, android_id, apk_version, last_seen_at")
    .order("receiver_label");

  const allBranchAccount = canAccessAllBranches(account);
  if (!account) {
    receiversQuery = receiversQuery.eq("branch_id", -1);
  } else if (!allBranchAccount) {
    receiversQuery = receiversQuery.eq("branch_id", account.branch_id);
  }
  const { data: receiverRows } = await receiversQuery;
  const scopedReceivers = (receiverRows ?? []) as ReceiverDbRow[];

  // ── Branch picker (all-branch accounts only) ──
  // Nursing branches only; the DEMO branch is hidden unless the account
  // itself is based there. Defaults to the first branch that has a receiver.
  let branchOptions: BranchOption[] = [];
  let selectedBranchId = account?.branch_id ?? -1;
  if (account && allBranchAccount) {
    const { data: branchRows } = await adminClient
      .from("tbl_branches")
      .select("BranchID, locale:BranchLocale, code:BranchCode")
      .eq("Function", "NUR")
      .order("BranchCode");
    branchOptions = ((branchRows ?? []) as { BranchID: number; locale: string | null; code: string }[])
      .filter((b) => b.code !== "DEMO" || b.BranchID === account.branch_id)
      .map((b) => ({ id: Number(b.BranchID), name: formatBranch(b) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const withReceiver = new Set(scopedReceivers.map((r) => r.branch_id));
    const requested = Number(branch);
    selectedBranchId =
      branchOptions.find((b) => b.id === requested)?.id ??
      branchOptions.find((b) => withReceiver.has(b.id))?.id ??
      branchOptions[0]?.id ??
      -1;
  }

  const receiverList = scopedReceivers.filter((r) => r.branch_id === selectedBranchId);
  const receiverIds = receiverList.map((r) => r.id);
  const branchIds = [selectedBranchId];
  const receiverLabelById = Object.fromEntries(receiverList.map((r) => [r.id, r.receiver_label]));

  const picker = branchOptions.length > 1 && (
    <CallbellBranchPicker branches={branchOptions} currentBranch={selectedBranchId} />
  );

  if (receiverIds.length === 0) {
    return (
      <div>
        <PageTitle title={t("Call Bell")} />
        {picker}
        <p className="mt-6 text-sm text-fg-faint">{t("No receivers found.")}</p>
      </div>
    );
  }

  // ── All data in parallel ──
  // Assignment tab = receiver device inventory (cb_assignments rows written by
  // /api/callbell/devices from the Wenze getalldevices API) + resident assignment.
  // Call logs are NOT used to discover devices.
  const [logsResult, inventoryResult, residentsResult] = await Promise.all([
    adminClient
      .from("cb_call_logs")
      .select("id, receiver_id, device_num, resident_name_snapshot, resident_nickname, call_time, response_time")
      .in("receiver_id", receiverIds)
      .order("call_time", { ascending: false, nullsFirst: false })
      .limit(200),

    adminClient
      .from("cb_assignments")
      .select("receiver_id, device_num, resident_id, room_label, tbl_residents(resident_name)")
      .in("receiver_id", receiverIds),

    adminClient
      .from("tbl_residents")
      .select("id, resident_name, branch_id")
      .in("branch_id", branchIds)
      .eq("status", "ACTIVE")
      .order("resident_name"),
  ]);

  const branchIdByReceiver = Object.fromEntries(receiverList.map((r) => [r.id, r.branch_id]));

  type InventoryDbRow = { receiver_id: number; device_num: string; resident_id: number | null; room_label: string | null; tbl_residents: { resident_name: string } | { resident_name: string }[] | null };
  const devices: BellDevice[] = ((inventoryResult.data ?? []) as InventoryDbRow[])
    .map((row) => {
      const res = Array.isArray(row.tbl_residents) ? row.tbl_residents[0] : row.tbl_residents;
      return {
        receiver_id: row.receiver_id,
        branch_id: branchIdByReceiver[row.receiver_id],
        device_num: row.device_num,
        call_number: row.room_label ?? "",
        resident_id: row.resident_id,
        resident_name: res?.resident_name ?? "",
      };
    })
    .sort((a, b) =>
      a.call_number.localeCompare(b.call_number, undefined, { numeric: true }) ||
      a.device_num.localeCompare(b.device_num)
    );

  // ── Call logs ──
  // bell_no  = CALL_RECORDING_BEAN.NAME (call number)
  // resident = CALL_RECORDING_BEAN.NICK_NAME as recorded at call time — never
  //            looked up from current assignments, so history is stable.
  const logs: CallLogRow[] = (logsResult.data ?? []).map((row) => {
    const ct = Number(row.call_time) || 0;
    const rt = Number(row.response_time) || 0;
    return {
      id: row.id as number,
      receiver_label: receiverLabelById[row.receiver_id as number] ?? "—",
      device_num: (row.device_num as string) ?? "",
      bell_no: (row.resident_name_snapshot as string) ?? "",
      resident_name: (row.resident_nickname as string) ?? "",
      call_time_display: fmtCallTime(row.call_time as string | number | null),
      response_time_display: fmtResponseDuration(
        row.call_time as string | number | null,
        row.response_time as string | number | null
      ),
      slow_response: ct > 0 && rt > ct && rt - ct > SLOW_RESPONSE_MS,
    };
  });

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
    branch_id: r.branch_id as number,
    resident_name: (r.resident_name as string) ?? "",
  }));

  return (
    <div>
      <PageTitle title={t("Call Bell")} />
      {picker}
      <CallbellTabs
        logs={logs}
        devices={devices}
        receivers={receivers}
        residents={residents}
      />
    </div>
  );
}
