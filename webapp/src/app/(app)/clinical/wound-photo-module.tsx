"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format-date";
import { NewWoundPhotoForm } from "./new-wound-photo-form";
import type { WoundSession } from "./wound-photo-actions";
import { useNavPush } from "@/components/nav-loading";
import type { LookupOption } from "@/lib/types";
import type { WoundBodyPart } from "./wound-body-diagram";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import { ListChecks, Plus } from "lucide-react";

type Resident = { id: number; resident_name: string; branch_id: number };

type Props = {
  sessions: WoundSession[];
  residents: Resident[];
  allStaff: (LookupOption & { branch_id: number })[];
  bodyParts: WoundBodyPart[];
  currentResident: string;
  currentStart: string;
  currentEnd: string;
  error: string | null;
};

export function WoundPhotoModule({ sessions, residents, allStaff, bodyParts, currentResident, currentStart, currentEnd, error }: Props) {
  const router = useRouter();
  const push = useNavPush();
  const t = useTranslation();
  const [innerTab, setInnerTab] = useState<"review" | "new">("review");

  function applyFilters(residentId: string, start: string, end: string) {
    const params = new URLSearchParams();
    params.set("tab", "wound-photo");
    if (residentId) params.set("resident", residentId);
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    push(`/clinical?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <TabRow>
        <TabButton icon={ListChecks} size="sm" active={innerTab === "review"} onClick={() => setInnerTab("review")}>
          {t("Wound Photo History")}
        </TabButton>
        <TabButton icon={Plus} size="sm" active={innerTab === "new"} onClick={() => setInnerTab("new")}>
          {t("New Entry")}
        </TabButton>
      </TabRow>

      {innerTab === "review" ? (
        <>
          <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t("Resident")}</label>
                <select
                  value={currentResident}
                  onChange={(e) => applyFilters(e.target.value, currentStart, currentEnd)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">{t("All residents")}</option>
                  {residents.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.resident_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t("Start date")}</label>
                <input
                  type="date"
                  value={currentStart}
                  onChange={(e) => applyFilters(currentResident, e.target.value, currentEnd)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t("End date")}</label>
                <input
                  type="date"
                  value={currentEnd}
                  onChange={(e) => applyFilters(currentResident, currentStart, e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="space-y-3">
            {sessions.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
                {t("No wound photo sessions yet.")}
              </div>
            ) : (
              sessions.map((session) => (
                <div key={session.id} className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="font-bold text-gray-900">{session.tbl_residents?.resident_name}</span>
                    <span className="text-xs text-gray-400">{formatDateTime(session.session_started_at)}</span>
                  </div>
                  <div className="mb-3 text-xs text-gray-400">
                    {t("Uploaded by")}: {session.uploader?.staff_name || "--"}
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {session.photos.map((photo) => (
                      <div key={photo.id} className="overflow-hidden rounded-md border border-gray-200">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/wound-photos/${photo.id}`} alt={photo.body_part_label} className="h-32 w-full object-cover" loading="lazy" />
                        <div className="p-2">
                          <p className="text-xs font-medium text-gray-900">{t(photo.body_part_label)}</p>
                          {photo.description && <p className="text-xs text-gray-500">{photo.description}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        <NewWoundPhotoForm
          residents={residents}
          allStaff={allStaff}
          bodyParts={bodyParts}
          presetResidentId={currentResident || undefined}
          onSaved={() => {
            setInnerTab("review");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
