"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, Users, Wifi, Pencil, Check, X } from "lucide-react";
import { TabRow, TabButton } from "@/components/tabs";
import { useTranslation } from "@/components/language-provider";

export type CallLogRow = {
  id: number;
  receiver_label: string;
  device_num: string;
  resident_name: string;
  call_type: string;
  call_time_display: string;
  response_time_display: string;
};

export type KnownDevice = {
  receiver_id: number;
  receiver_label: string;
  device_num: string;
  assignment_id: number | null;
  resident_id: number | null;
  resident_name: string;
  room_label: string;
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
  resident_name: string;
};

type Tab = "logs" | "assignments" | "receivers";

type EditState = {
  resident_id: string;
  room_label: string;
};

type LogFilters = {
  device: string;
  resident: string;
  call_type: string;
  receiver: string;
};

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
}: {
  logs: CallLogRow[];
  devices: KnownDevice[];
  receivers: ReceiverRow[];
  residents: ResidentOption[];
}) {
  const t = useTranslation();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("logs");

  // ── Assignments edit ──
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ resident_id: "", room_label: "" });
  const [saving, startSaving] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Call log filters ──
  const [filters, setFilters] = useState<LogFilters>({
    device: "",
    resident: "",
    call_type: "",
    receiver: "",
  });

  function setFilter(key: keyof LogFilters, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  const filteredLogs = logs.filter((row) => {
    if (filters.device && !row.device_num.toLowerCase().includes(filters.device.toLowerCase())) return false;
    if (filters.resident && !row.resident_name.toLowerCase().includes(filters.resident.toLowerCase())) return false;
    if (filters.call_type && !row.call_type.toLowerCase().includes(filters.call_type.toLowerCase())) return false;
    if (filters.receiver && !row.receiver_label.toLowerCase().includes(filters.receiver.toLowerCase())) return false;
    return true;
  });

  const hasFilters = filters.device || filters.resident || filters.call_type || filters.receiver;

  // ── Assignment helpers ──
  function deviceKey(d: KnownDevice) {
    return `${d.receiver_id}:${d.device_num}`;
  }

  function startEdit(d: KnownDevice) {
    setEditingKey(deviceKey(d));
    setEditState({
      resident_id: d.resident_id ? String(d.resident_id) : "",
      room_label: d.room_label,
    });
    setSaveError(null);
  }

  function cancelEdit() {
    setEditingKey(null);
    setSaveError(null);
  }

  function saveEdit(d: KnownDevice) {
    setSaveError(null);
    startSaving(async () => {
      const res = await fetch("/api/callbell/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiver_id: d.receiver_id,
          device_num: d.device_num,
          resident_id: editState.resident_id ? Number(editState.resident_id) : null,
          room_label: editState.room_label || null,
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

  return (
    <div>
      <TabRow className="mb-4">
        <TabButton active={tab === "logs"} onClick={() => setTab("logs")} icon={Bell}>
          {t("Call Logs")}
        </TabButton>
        <TabButton active={tab === "assignments"} onClick={() => setTab("assignments")} icon={Users}>
          {t("Assignments")}
        </TabButton>
        <TabButton active={tab === "receivers"} onClick={() => setTab("receivers")} icon={Wifi}>
          {t("Receivers")}
        </TabButton>
      </TabRow>

      {/* ── Call Logs ── */}
      {tab === "logs" && (
        <div>
          {hasFilters && (
            <p className="mb-2 text-xs text-fg-subtle">
              {t("Showing")} {filteredLogs.length} / {logs.length} {t("records")}
              <button
                type="button"
                onClick={() => setFilters({ device: "", resident: "", call_type: "", receiver: "" })}
                className="ml-2 text-indigo-500 underline hover:text-indigo-700"
              >
                {t("Clear filters")}
              </button>
            </p>
          )}
          <div className="overflow-x-auto rounded-md border border-line bg-surface shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs font-medium uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th className="px-4 py-2">{t("Call Time")}</th>
                  <th className="px-4 py-2 min-w-[110px]">
                    {t("Device")}
                    <FilterInput value={filters.device} onChange={(v) => setFilter("device", v)} />
                  </th>
                  <th className="px-4 py-2 min-w-[130px]">
                    {t("Resident")}
                    <FilterInput value={filters.resident} onChange={(v) => setFilter("resident", v)} />
                  </th>
                  <th className="px-4 py-2 min-w-[100px]">
                    {t("Call Type")}
                    <FilterInput value={filters.call_type} onChange={(v) => setFilter("call_type", v)} />
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
                    <td className="px-4 py-2 text-fg-muted">{row.resident_name || "—"}</td>
                    <td className="px-4 py-2 text-fg-muted">{row.call_type || "—"}</td>
                    <td className="px-4 py-2 text-fg-muted">{row.response_time_display}</td>
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
          <p className="mb-3 text-xs text-fg-subtle">
            {t("Devices seen in call logs. Click Edit to assign a resident.")}
          </p>
          <div className="overflow-x-auto rounded-md border border-line bg-surface shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs font-medium uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th className="px-4 py-2">{t("Device")}</th>
                  <th className="px-4 py-2">{t("Resident")}</th>
                  <th className="px-4 py-2">{t("Room")}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {devices.map((d) => {
                  const key = deviceKey(d);
                  const isEditing = editingKey === key;

                  if (isEditing) {
                    return (
                      <tr key={key} className="bg-surface-muted">
                        <td className="px-4 py-2 font-mono text-xs text-fg">{d.device_num}</td>
                        <td className="px-4 py-2">
                          <select
                            value={editState.resident_id}
                            onChange={(e) => setEditState((s) => ({ ...s, resident_id: e.target.value }))}
                            className="w-full rounded border border-line bg-surface px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                          >
                            <option value="">{t("Unassigned")}</option>
                            {residents.map((r) => (
                              <option key={r.id} value={String(r.id)}>
                                {r.resident_name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={editState.room_label}
                            onChange={(e) => setEditState((s) => ({ ...s, room_label: e.target.value }))}
                            placeholder={t("Room")}
                            className="w-full rounded border border-line bg-surface px-2 py-1 text-sm text-fg placeholder:text-fg-faint focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                          />
                        </td>
                        <td className="px-4 py-2">
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
                            {saveError && (
                              <span className="text-xs text-red-500">{saveError}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={key} className="hover:bg-hover">
                      <td className="px-4 py-2 font-mono text-xs text-fg">{d.device_num}</td>
                      <td className="px-4 py-2 text-fg-muted">
                        {d.resident_name || (
                          <span className="italic text-fg-faint">{t("Unassigned")}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-fg-muted">{d.room_label || "—"}</td>
                      <td className="px-4 py-2">
                        <button
                          type="button"
                          onClick={() => startEdit(d)}
                          className="flex items-center gap-1 rounded border border-line px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-hover hover:text-fg"
                        >
                          <Pencil className="h-3 w-3" />
                          {d.resident_id ? t("Edit") : t("Assign")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {devices.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-fg-faint">
                      {t("No devices seen in call logs yet.")}
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
