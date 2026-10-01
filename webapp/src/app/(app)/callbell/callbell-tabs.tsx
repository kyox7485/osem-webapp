"use client";

import { useState } from "react";
import { Bell, Users, Wifi } from "lucide-react";
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
  duration: string;
};

export type AssignmentRow = {
  id: number;
  receiver_label: string;
  device_num: string;
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

type Tab = "logs" | "assignments" | "receivers";

export function CallbellTabs({
  logs,
  assignments,
  receivers,
}: {
  logs: CallLogRow[];
  assignments: AssignmentRow[];
  receivers: ReceiverRow[];
}) {
  const t = useTranslation();
  const [tab, setTab] = useState<Tab>("logs");

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

      {tab === "logs" && (
        <div className="overflow-x-auto rounded-md border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs font-medium uppercase tracking-wide text-fg-subtle">
              <tr>
                <th className="px-4 py-2">{t("Call Time")}</th>
                <th className="px-4 py-2">{t("Device")}</th>
                <th className="px-4 py-2">{t("Resident")}</th>
                <th className="px-4 py-2">{t("Call Type")}</th>
                <th className="px-4 py-2">{t("Duration")}</th>
                <th className="px-4 py-2">{t("Response Time")}</th>
                <th className="px-4 py-2">{t("Receiver")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {logs.map((row) => (
                <tr key={row.id} className="hover:bg-hover">
                  <td className="px-4 py-2 font-medium text-fg">{row.call_time_display}</td>
                  <td className="px-4 py-2 text-fg-muted">{row.device_num || "—"}</td>
                  <td className="px-4 py-2 text-fg-muted">{row.resident_name || "—"}</td>
                  <td className="px-4 py-2 text-fg-muted">{row.call_type || "—"}</td>
                  <td className="px-4 py-2 text-fg-muted">{row.duration || "—"}</td>
                  <td className="px-4 py-2 text-fg-muted">{row.response_time_display}</td>
                  <td className="px-4 py-2 text-fg-muted">{row.receiver_label}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-fg-faint">
                    {t("No call logs found.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "assignments" && (
        <div className="overflow-x-auto rounded-md border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs font-medium uppercase tracking-wide text-fg-subtle">
              <tr>
                <th className="px-4 py-2">{t("Receiver")}</th>
                <th className="px-4 py-2">{t("Device")}</th>
                <th className="px-4 py-2">{t("Resident")}</th>
                <th className="px-4 py-2">{t("Room")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {assignments.map((row) => (
                <tr key={row.id} className="hover:bg-hover">
                  <td className="px-4 py-2 font-medium text-fg">{row.receiver_label}</td>
                  <td className="px-4 py-2 text-fg-muted">{row.device_num}</td>
                  <td className="px-4 py-2 text-fg-muted">
                    {row.resident_name || (
                      <span className="text-fg-faint italic">{t("Unassigned")}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-fg-muted">{row.room_label || "—"}</td>
                </tr>
              ))}
              {assignments.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-fg-faint">
                    {t("No assignments found.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

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
