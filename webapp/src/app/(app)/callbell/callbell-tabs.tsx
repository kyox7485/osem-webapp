"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, BellRing, Users, Wifi, Pencil, Check, X, RefreshCw, Download } from "lucide-react";
import { TabRow, TabButton } from "@/components/tabs";
import { useTranslation } from "@/components/language-provider";
import { Combobox } from "@/components/combobox";
import type { LookupOption } from "@/lib/types";

export type CallLogRow = {
  id: number;
  receiver_label: string;
  device_num: string;
  bell_no: string;
  resident_name: string;
  call_time_display: string;
  response_time_display: string;
  slow_response: boolean;
  disarmed: boolean;
};

// One paired bell from the receiver inventory (Wenze getalldevices).
// device_num and call_number come from the receiver and are read-only here.
export type BellDevice = {
  receiver_id: number;
  branch_id: number;
  device_num: string;
  call_number: string;
  resident_id: number | null;
  resident_name: string;
  disarmed_until: string | null; // display time; null = armed
  disarm_note: string;
};

export type BranchOption = {
  id: number;
  name: string;
};

export type ReceiverRow = {
  id: number;
  receiver_label: string;
  android_id: string;
  apk_version: string;
  last_seen_display: string;
};

export type ResidentOption = {
  id: number;
  branch_id: number;
  resident_name: string;
};

type Tab = "logs" | "assignments" | "receivers";

type LogFilters = {
  device: string;
  bell_no: string;
  resident: string;
  receiver: string;
};

// Disarm durations offered to moderators/admins (minutes).
const DISARM_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 240, label: "4 hours" },
  { minutes: 480, label: "8 hours" },
  { minutes: 720, label: "12 hours" },
  { minutes: 1440, label: "24 hours" },
  { minutes: 4320, label: "3 days" },
  { minutes: 10080, label: "7 days" },
];

const EMPTY_FILTERS: LogFilters = { device: "", bell_no: "", resident: "", receiver: "" };

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function downloadCsv(filename: string, header: string[], rows: string[][]) {
  // BOM so Excel opens UTF-8 names correctly.
  const csv = "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function FilterInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? "Filter…"}
      className="mt-1 block w-full rounded border border-line bg-surface px-1.5 py-0.5 text-xs font-normal text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-indigo-500/40 normal-case tracking-normal"
    />
  );
}

export function CallbellTabs({
  logs,
  devices,
  receivers,
  residents,
  canDisarm,
}: {
  logs: CallLogRow[];
  devices: BellDevice[];
  receivers: ReceiverRow[];
  residents: ResidentOption[];
  canDisarm: boolean;
}) {
  const t = useTranslation();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("assignments");

  // ── Assignments edit ──
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editResidentId, setEditResidentId] = useState("");
  const [saving, startSaving] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Disarm (MODERATOR/ADMIN) ──
  const [disarmKey, setDisarmKey] = useState<string | null>(null);
  const [disarmMinutes, setDisarmMinutes] = useState(60);
  const [disarmReason, setDisarmReason] = useState("");
  const [disarmError, setDisarmError] = useState<string | null>(null);
  const [rearmError, setRearmError] = useState<{ key: string; msg: string } | null>(null);

  // ── Call log filters ──
  const [filters, setFilters] = useState<LogFilters>(EMPTY_FILTERS);
  const [refreshing, startRefresh] = useTransition();

  function setFilter(key: keyof LogFilters, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  const filteredLogs = logs.filter((row) => {
    if (filters.device && !row.device_num.toLowerCase().includes(filters.device.toLowerCase())) return false;
    if (filters.bell_no && !row.bell_no.toLowerCase().includes(filters.bell_no.toLowerCase())) return false;
    if (filters.resident && !row.resident_name.toLowerCase().includes(filters.resident.toLowerCase())) return false;
    if (filters.receiver && !row.receiver_label.toLowerCase().includes(filters.receiver.toLowerCase())) return false;
    return true;
  });

  const hasFilters = filters.device || filters.bell_no || filters.resident || filters.receiver;

  function exportLogsCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(
      `call-logs-${stamp}.csv`,
      ["Call Time", "Device", "Bell No.", "Resident", "Response Time", "Over 15 min", "Receiver"],
      filteredLogs.map((r) => [
        r.call_time_display,
        r.device_num,
        r.bell_no,
        r.resident_name,
        r.response_time_display,
        r.disarmed ? "Disarmed" : r.slow_response ? "Yes" : "",
        r.receiver_label,
      ])
    );
  }

  // ── Assignment helpers ──
  // Devices/residents arrive already scoped to the selected branch (page ?branch=).
  const branchDevices = devices;
  // A resident can hold only one bell: hide residents already on another bell.
  const takenResidentIds = new Set(devices.filter((d) => d.resident_id).map((d) => d.resident_id as number));
  function residentOptionsFor(d: BellDevice): LookupOption[] {
    return residents
      .filter((r) => r.branch_id === d.branch_id && (r.id === d.resident_id || !takenResidentIds.has(r.id)))
      .map((r) => ({ id: r.id, label: r.resident_name }));
  }

  function deviceKey(d: BellDevice) {
    return `${d.receiver_id}:${d.device_num}`;
  }

  function startEdit(d: BellDevice) {
    setDisarmKey(null);
    setEditingKey(deviceKey(d));
    setEditResidentId(d.resident_id ? String(d.resident_id) : "");
    setSaveError(null);
  }

  function cancelEdit() {
    setEditingKey(null);
    setSaveError(null);
  }

  function saveEdit(d: BellDevice, residentId: string = editResidentId) {
    setSaveError(null);
    startSaving(async () => {
      const res = await fetch("/api/callbell/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiver_id: d.receiver_id,
          device_num: d.device_num,
          resident_id: residentId ? Number(residentId) : null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveError((body as { error?: string }).error ?? "Save failed");
        return;
      }
      setEditingKey(null);
      router.refresh();
    });
  }

  function startDisarm(d: BellDevice) {
    setEditingKey(null);
    setDisarmKey(deviceKey(d));
    setDisarmMinutes(60);
    setDisarmReason("");
    setDisarmError(null);
  }

  function submitDisarm(d: BellDevice, rearm: boolean) {
    setDisarmError(null);
    setRearmError(null);
    startSaving(async () => {
      const res = await fetch("/api/callbell/disarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          rearm
            ? { receiver_id: d.receiver_id, device_num: d.device_num, rearm: true }
            : { receiver_id: d.receiver_id, device_num: d.device_num, minutes: disarmMinutes, reason: disarmReason }
        ),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as { error?: string }).error ?? "Save failed";
        if (rearm) setRearmError({ key: deviceKey(d), msg });
        else setDisarmError(msg);
        return;
      }
      setDisarmKey(null);
      router.refresh();
    });
  }

  return (
    <div>
      <TabRow className="mb-4">
        <TabButton active={tab === "assignments"} onClick={() => setTab("assignments")} icon={Users}>
          {t("Assignments")}
        </TabButton>
        <TabButton active={tab === "logs"} onClick={() => setTab("logs")} icon={Bell}>
          {t("Call Logs")}
        </TabButton>
        <TabButton active={tab === "receivers"} onClick={() => setTab("receivers")} icon={Wifi}>
          {t("Receivers")}
        </TabButton>
      </TabRow>

      {/* ── Call Logs ── */}
      {tab === "logs" && (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => startRefresh(() => router.refresh())}
              disabled={refreshing}
              className="flex items-center gap-1 rounded border border-line px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
              {t("Refresh")}
            </button>
            <button
              type="button"
              onClick={exportLogsCsv}
              disabled={filteredLogs.length === 0}
              className="flex items-center gap-1 rounded border border-line px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-50"
            >
              <Download className="h-3 w-3" />
              {t("Export CSV")}
            </button>
            <span className="text-xs text-fg-subtle">
              {hasFilters ? (
                <>
                  {t("Showing")} {filteredLogs.length} / {logs.length} {t("records")}
                  <button
                    type="button"
                    onClick={() => setFilters(EMPTY_FILTERS)}
                    className="ml-2 text-indigo-500 underline hover:text-indigo-700"
                  >
                    {t("Clear filters")}
                  </button>
                </>
              ) : (
                <>
                  {logs.length} {t("records")}
                </>
              )}
            </span>
          </div>
          <div className="overflow-x-auto rounded-md border border-line bg-surface shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs font-medium uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th className="px-4 py-2">{t("Call Time")}</th>
                  <th className="px-4 py-2 min-w-[110px]">
                    {t("Device")}
                    <FilterInput value={filters.device} onChange={(v) => setFilter("device", v)} />
                  </th>
                  <th className="px-4 py-2 min-w-[100px]">
                    {t("Bell No.")}
                    <FilterInput value={filters.bell_no} onChange={(v) => setFilter("bell_no", v)} />
                  </th>
                  <th className="px-4 py-2 min-w-[140px]">
                    {t("Resident")}
                    <FilterInput value={filters.resident} onChange={(v) => setFilter("resident", v)} />
                  </th>
                  <th className="px-4 py-2">{t("Response Time")}</th>
                  <th className="px-4 py-2 min-w-[110px]">
                    {t("Receiver")}
                    <FilterInput value={filters.receiver} onChange={(v) => setFilter("receiver", v)} />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {filteredLogs.map((row) => (
                  <tr key={row.id} className="hover:bg-hover">
                    <td className="px-4 py-2 font-medium text-fg">{row.call_time_display}</td>
                    <td className="px-4 py-2 font-mono text-xs text-fg-muted">{row.device_num || "—"}</td>
                    <td className="px-4 py-2 font-medium text-fg">{row.bell_no || "—"}</td>
                    <td className="px-4 py-2 text-fg-muted">{row.resident_name || "—"}</td>
                    <td
                      className={
                        row.slow_response
                          ? "px-4 py-2 font-semibold text-red-600 dark:text-red-400"
                          : "px-4 py-2 text-fg-muted"
                      }
                      title={
                        row.disarmed
                          ? t("Bell was disarmed: the call was logged but not announced")
                          : row.slow_response
                            ? t("Response slower than 15 minutes")
                            : undefined
                      }
                    >
                      {row.disarmed ? (
                        <span className="inline-flex items-center gap-1 text-xs italic text-fg-faint">
                          <BellOff className="h-3 w-3" />
                          {t("Disarmed")}
                        </span>
                      ) : (
                        row.response_time_display
                      )}
                    </td>
                    <td className="px-4 py-2 text-fg-muted">{row.receiver_label}</td>
                  </tr>
                ))}
                {filteredLogs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-fg-faint">
                      {hasFilters ? t("No records match the current filters.") : t("No call logs found.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Assignments ── */}
      {tab === "assignments" && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <p className="text-xs text-fg-subtle">
              {t("Call bells paired on the receiver. Select a resident for each bell.")}
            </p>
            {canDisarm && (
              <p className="text-xs text-fg-subtle">
                {t("Disarm stops the receiver announcing a bell for a set time. Its calls are still logged.")}
              </p>
            )}
          </div>
          {/* overflow-visible so the resident combobox popup is not clipped */}
          <div className="rounded-md border border-line bg-surface shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs font-medium uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th className="px-4 py-2">{t("Device ID")}</th>
                  <th className="px-4 py-2">{t("Call Number")}</th>
                  <th className="px-4 py-2">{t("Resident")}</th>
                  <th className="px-4 py-2">{t("Action")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {branchDevices.map((d) => {
                  const key = deviceKey(d);
                  const isEditing = editingKey === key;
                  const isDisarming = disarmKey === key;
                  return (
                    <tr key={key} className={isEditing ? "bg-surface-muted" : "hover:bg-hover"}>
                      <td className="px-4 py-2 font-mono text-xs text-fg">{d.device_num}</td>
                      <td className="px-4 py-2 font-medium text-fg">{d.call_number || "—"}</td>
                      <td className="px-4 py-2 text-fg-muted">
                        {isEditing ? (
                          <Combobox
                            id={`resident-${d.device_num}`}
                            value={editResidentId}
                            onChange={setEditResidentId}
                            options={residentOptionsFor(d)}
                            label={t("Resident")}
                            hideLabel
                            placeholder={t("Type a name to search...")}
                            emptyMessage={t("No matching unassigned resident")}
                            className="min-w-[220px]"
                          />
                        ) : (
                          d.resident_name || <span className="italic text-fg-faint">{t("Unassigned")}</span>
                        )}
                        {d.disarmed_until && (
                          <span
                            className="ml-2 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                            title={d.disarm_note || undefined}
                          >
                            <BellOff className="h-3 w-3" />
                            {t("Disarmed until")} {d.disarmed_until}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => saveEdit(d)}
                              disabled={saving}
                              className="flex items-center gap-1 rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                            >
                              <Check className="h-3 w-3" />
                              {t("Save")}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={saving}
                              className="flex items-center gap-1 rounded border border-line px-3 py-1 text-xs font-medium text-fg-muted hover:bg-hover disabled:opacity-50"
                            >
                              <X className="h-3 w-3" />
                              {t("Cancel")}
                            </button>
                            {d.resident_id && (
                              <button
                                type="button"
                                onClick={() => saveEdit(d, "")}
                                disabled={saving}
                                className="rounded border border-line px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
                              >
                                {t("Unassign")}
                              </button>
                            )}
                            {saveError && <span className="text-xs text-red-500">{saveError}</span>}
                          </div>
                        ) : isDisarming ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={disarmMinutes}
                              onChange={(e) => setDisarmMinutes(Number(e.target.value))}
                              aria-label={t("Disarm for")}
                              className="rounded border border-line-strong bg-input px-2 py-1 text-xs text-fg focus:border-indigo-500 focus:outline-none"
                            >
                              {DISARM_OPTIONS.map((o) => (
                                <option key={o.minutes} value={o.minutes}>
                                  {t(o.label)}
                                </option>
                              ))}
                            </select>
                            <input
                              type="text"
                              value={disarmReason}
                              onChange={(e) => setDisarmReason(e.target.value)}
                              maxLength={200}
                              placeholder={t("Reason (optional)")}
                              className="w-40 rounded border border-line-strong bg-input px-2 py-1 text-xs text-fg placeholder:text-fg-faint focus:border-indigo-500 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => submitDisarm(d, false)}
                              disabled={saving}
                              className="flex items-center gap-1 rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                            >
                              <BellOff className="h-3 w-3" />
                              {t("Disarm")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDisarmKey(null)}
                              disabled={saving}
                              className="flex items-center gap-1 rounded border border-line px-3 py-1 text-xs font-medium text-fg-muted hover:bg-hover disabled:opacity-50"
                            >
                              <X className="h-3 w-3" />
                              {t("Cancel")}
                            </button>
                            {disarmError && <span className="text-xs text-red-500">{disarmError}</span>}
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => startEdit(d)}
                              className="flex items-center gap-1 rounded border border-line px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-hover hover:text-fg"
                            >
                              <Pencil className="h-3 w-3" />
                              {d.resident_id ? t("Edit") : t("Assign")}
                            </button>
                            {canDisarm &&
                              (d.disarmed_until ? (
                                <button
                                  type="button"
                                  onClick={() => submitDisarm(d, true)}
                                  disabled={saving}
                                  className="flex items-center gap-1 rounded border border-line px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-hover disabled:opacity-50 dark:text-emerald-400"
                                >
                                  <BellRing className="h-3 w-3" />
                                  {t("Re-arm")}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => startDisarm(d)}
                                  className="flex items-center gap-1 rounded border border-line px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-hover dark:text-amber-400"
                                >
                                  <BellOff className="h-3 w-3" />
                                  {t("Disarm")}
                                </button>
                              ))}
                            {rearmError?.key === key && <span className="text-xs text-red-500">{rearmError.msg}</span>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {branchDevices.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-fg-faint">
                      {t("No call bells received from the receiver yet. On the receiver, open OSEM LoRa Sync and press SYNC DEVICES + ASSIGNMENTS.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Receivers ── */}
      {tab === "receivers" && (
        <div className="overflow-x-auto rounded-md border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs font-medium uppercase tracking-wide text-fg-subtle">
              <tr>
                <th className="px-4 py-2">{t("Receiver")}</th>
                <th className="px-4 py-2">{t("APK Version")}</th>
                <th className="px-4 py-2">{t("Last Seen")}</th>
                <th className="px-4 py-2">{t("Android ID")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {receivers.map((row) => (
                <tr key={row.id} className="hover:bg-hover">
                  <td className="px-4 py-2 font-medium text-fg">{row.receiver_label}</td>
                  <td className="px-4 py-2 text-fg-muted">{row.apk_version || "—"}</td>
                  <td className="px-4 py-2 text-fg-muted">{row.last_seen_display}</td>
                  <td className="px-4 py-2 font-mono text-xs text-fg-faint">{row.android_id || "—"}</td>
                </tr>
              ))}
              {receivers.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-fg-faint">
                    {t("No receivers found.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
