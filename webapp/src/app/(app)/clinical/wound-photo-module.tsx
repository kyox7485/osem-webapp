"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime, formatMonthYear } from "@/lib/format-date";
import { NewWoundPhotoForm } from "./new-wound-photo-form";
import type { WoundSession, WoundPhoto } from "./wound-photo-actions";
import { useNavPush } from "@/components/nav-loading";
import type { LookupOption } from "@/lib/types";
import type { WoundBodyPart } from "./wound-body-diagram";
import { WoundProgressionDashboard } from "./wound-progression-dashboard";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { ListChecks, Plus, TrendingUp, ChevronRight, Images } from "lucide-react";
import { AdminRecordControls, useIsHqAdmin } from "@/components/admin-record-controls";
import { BranchFilterSelect } from "./branch-filter-select";
import { ResultNotice } from "./result-notice";

type Resident = { id: number; resident_name: string; branch_id: number };

type Props = {
  sessions: WoundSession[];
  residents: Resident[];
  branches: LookupOption[];
  currentBranch: string;
  allStaff: (LookupOption & { branch_id: number; branch_function: string })[];
  bodyParts: WoundBodyPart[];
  currentResident: string;
  currentStart: string;
  currentEnd: string;
  error: string | null;
  /** The server hit its row cap -- the list below is the most recent N, not all. */
  truncated?: boolean;
};

type PhotoGroup = {
  /** "2026-09-14" -- the Kuala Lumpur wall-clock day, matching formatDate(). */
  dayKey: string;
  label: string;
  sessions: WoundSession[];
  photoCount: number;
};

type MonthGroup = { monthKey: string; label: string; days: PhotoGroup[] };

type ResidentGroup = {
  key: string;
  name: string;
  sessionCount: number;
  photoCount: number;
  latestIso: string;
  years: { year: string; months: MonthGroup[] }[];
};

// Pulls the calendar parts out of a session timestamp in the same pinned
// zone format-date.ts formats with. Deriving the group keys from the
// rendered values (rather than raw Date getters) is what keeps a session
// taken at 23:30 MYT in the day a nurse actually filed it under, instead of
// sliding into the previous day whenever the server happens to run in UTC.
function sessionParts(iso: string) {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { year: get("year"), month: get("month"), day: get("day") };
}

function pluralPhotos(t: (s: string) => string, n: number) {
  return `${n} ${t(n === 1 ? "photo" : "photos")}`;
}

function pluralSessions(t: (s: string) => string, n: number) {
  return `${n} ${t(n === 1 ? "session" : "sessions")}`;
}

// Three nested levels of collapsible sections. Every one starts closed, so
// the module renders as a text-only outline and issues zero requests for
// photo bytes until the user asks for a specific day.
export function WoundPhotoModule({ sessions, residents, branches, currentBranch, allStaff, bodyParts, currentResident, currentStart, currentEnd, error, truncated }: Props) {
  const router = useRouter();
  const push = useNavPush();
  const t = useTranslation();
  const isHqAdmin = useIsHqAdmin();
  const { guardedAction } = useSafeNavigation();
  const [innerTab, setInnerTab] = useState<"review" | "progression" | "new">("review");
  const [openResidents, setOpenResidents] = useState<Set<string>>(new Set());
  const [openYears, setOpenYears] = useState<Set<string>>(new Set());
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  // Composite keys ("r:12", "y:12:2026", ...) rather than bare values --
  // a year "2026" or a day "14" repeats across many parents, so an
  // unqualified key would open every matching group in the list at once.
  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const groups = useMemo<ResidentGroup[]>(() => {
    const byResident = new Map<string, ResidentGroup>();

    for (const session of sessions) {
      const residentId = session.resident_id;
      const key = `r:${residentId}`;
      let resident = byResident.get(key);
      if (!resident) {
        resident = {
          key,
          name: session.tbl_residents?.resident_name || t("Unknown"),
          sessionCount: 0,
          photoCount: 0,
          latestIso: session.session_started_at,
          years: [],
        };
        byResident.set(key, resident);
      }

      resident.sessionCount += 1;
      resident.photoCount += session.photos.length;
      if (session.session_started_at > resident.latestIso) resident.latestIso = session.session_started_at;

      const { year, month, day } = sessionParts(session.session_started_at);
      let yearGroup = resident.years.find((y) => y.year === year);
      if (!yearGroup) {
        yearGroup = { year, months: [] };
        resident.years.push(yearGroup);
      }
      let monthGroup = yearGroup.months.find((m) => m.monthKey === month);
      if (!monthGroup) {
        monthGroup = { monthKey: month, label: formatMonthYear(session.session_started_at), days: [] };
        yearGroup.months.push(monthGroup);
      }
      let dayGroup = monthGroup.days.find((d) => d.dayKey === day);
      if (!dayGroup) {
        dayGroup = { dayKey: day, label: day, sessions: [], photoCount: 0 };
        monthGroup.days.push(dayGroup);
      }
      dayGroup.sessions.push(session);
      dayGroup.photoCount += session.photos.length;
    }

    // Most recent resident first; sessions already arrive newest-first, so
    // the underlying arrays are in order, but sort explicitly rather than
    // relying on that to stay true after a query change.
    for (const resident of byResident.values()) {
      for (const year of resident.years) {
        year.months.sort((a, b) => b.monthKey.localeCompare(a.monthKey));
        for (const month of year.months) month.days.sort((a, b) => b.dayKey.localeCompare(a.dayKey));
      }
      resident.years.sort((a, b) => b.year.localeCompare(a.year));
    }

    return [...byResident.values()].sort((a, b) => b.latestIso.localeCompare(a.latestIso));
    // t is stable for a given language; re-grouping on language switch is
    // cheap next to the photo requests it avoids.
  }, [sessions, t]);

  function applyFilters(residentId: string, start: string, end: string, branchId: string) {
    const params = new URLSearchParams();
    params.set("tab", "wound-photo");
    if (branchId) params.set("branch", branchId);
    if (residentId) params.set("resident", residentId);
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    push(`/clinical?${params.toString()}`);
  }

  const sectionClass = "w-full rounded-md border border-line bg-surface shadow-sm";

  return (
    <div className="space-y-4">
      <TabRow>
        <TabButton icon={ListChecks} size="sm" active={innerTab === "review"} onClick={() => guardedAction(() => setInnerTab("review"))}>
          {t("Wound Photo History")}
        </TabButton>
        <TabButton icon={TrendingUp} size="sm" active={innerTab === "progression"} onClick={() => guardedAction(() => setInnerTab("progression"))}>
          {t("Wound Progression")}
        </TabButton>
        <TabButton icon={Plus} size="sm" active={innerTab === "new"} onClick={() => guardedAction(() => setInnerTab("new"))}>
          {t("New Entry")}
        </TabButton>
      </TabRow>

      {innerTab === "progression" ? (
        <WoundProgressionDashboard residents={residents} bodyParts={bodyParts} presetResidentId={currentResident || undefined} />
      ) : innerTab === "review" ? (
        <>
          <div className="rounded-md border border-line bg-surface p-4 shadow-sm">
            <div className={`grid grid-cols-1 gap-4 sm:grid-cols-3 ${isHqAdmin ? "lg:grid-cols-4" : ""}`}>
              <BranchFilterSelect
                branches={branches}
                currentBranch={currentBranch}
                onChange={(branchId) => applyFilters("", currentStart, currentEnd, branchId)}
                id="wp-branch-filter"
              />
              <div>
                <label className="mb-1 block text-sm font-medium text-fg-secondary">{t("Resident")}</label>
                <select
                  value={currentResident}
                  onChange={(e) => applyFilters(e.target.value, currentStart, currentEnd, currentBranch)}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm"
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
                <label className="mb-1 block text-sm font-medium text-fg-secondary">{t("Start date")}</label>
                <input
                  type="date"
                  value={currentStart}
                  onChange={(e) => applyFilters(currentResident, e.target.value, currentEnd, currentBranch)}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-fg-secondary">{t("End date")}</label>
                <input
                  type="date"
                  value={currentEnd}
                  onChange={(e) => applyFilters(currentResident, currentStart, e.target.value, currentBranch)}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          <ResultNotice error={error} truncated={truncated} />

          <div className="space-y-2">
            {groups.length === 0 ? (
              <div className="rounded-md border border-dashed border-line-strong p-6 text-center text-sm text-fg-faint">
                {t("No wound photo sessions yet.")}
              </div>
            ) : (
              groups.map((resident) => {
                const residentOpen = openResidents.has(resident.key);
                return (
                  <section key={resident.key} className={sectionClass}>
                    <button
                      type="button"
                      onClick={() => toggle(setOpenResidents, resident.key)}
                      aria-expanded={residentOpen}
                      className="flex w-full cursor-pointer items-center gap-2 p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                    >
                      <ChevronRight
                        size={16}
                        className={`shrink-0 text-fg-faint transition-transform ${residentOpen ? "rotate-90" : ""}`}
                        aria-hidden="true"
                      />
                      <span className="font-bold text-fg">{resident.name}</span>
                      <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-fg-faint">
                        <span>
                          {pluralSessions(t, resident.sessionCount)} · {pluralPhotos(t, resident.photoCount)}
                        </span>
                      </span>
                    </button>

                    {residentOpen && (
                      <div className="space-y-2 border-t border-line px-3 py-3">
                        {resident.years.map((year) => {
                          const yearKey = `${resident.key}:y:${year.year}`;
                          const yearOpen = openYears.has(yearKey);
                          return (
                            <div key={yearKey}>
                              <button
                                type="button"
                                onClick={() => toggle(setOpenYears, yearKey)}
                                aria-expanded={yearOpen}
                                className="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                              >
                                <ChevronRight
                                  size={14}
                                  className={`shrink-0 text-fg-faint transition-transform ${yearOpen ? "rotate-90" : ""}`}
                                  aria-hidden="true"
                                />
                                <span className="text-sm font-semibold text-fg-secondary">{year.year}</span>
                              </button>

                              {yearOpen && (
                                <div className="ml-5 space-y-2 border-l border-line pl-3">
                                  {year.months.map((month) => {
                                    const monthKey = `${yearKey}:m:${month.monthKey}`;
                                    const monthOpen = openMonths.has(monthKey);
                                    return (
                                      <div key={monthKey}>
                                        <button
                                          type="button"
                                          onClick={() => toggle(setOpenMonths, monthKey)}
                                          aria-expanded={monthOpen}
                                          className="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                                        >
                                          <ChevronRight
                                            size={14}
                                            className={`shrink-0 text-fg-faint transition-transform ${monthOpen ? "rotate-90" : ""}`}
                                            aria-hidden="true"
                                          />
                                          <span className="text-sm font-medium text-fg-secondary">{month.label}</span>
                                        </button>

                                        {monthOpen && (
                                          <div className="ml-5 space-y-2 border-l border-line pl-3">
                                            {month.days.map((day) => {
                                              const dayKey = `${monthKey}:d:${day.dayKey}`;
                                              const dayOpen = openDays.has(dayKey);
                                              return (
                                                <div key={dayKey}>
                                                  <button
                                                    type="button"
                                                    onClick={() => toggle(setOpenDays, dayKey)}
                                                    aria-expanded={dayOpen}
                                                    className="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                                                  >
                                                    <ChevronRight
                                                      size={14}
                                                      className={`shrink-0 text-fg-faint transition-transform ${dayOpen ? "rotate-90" : ""}`}
                                                      aria-hidden="true"
                                                    />
                                                    <span className="text-sm text-fg">
                                                      {t("Day")} {day.label}
                                                    </span>
                                                    <span className="ml-auto text-xs text-fg-faint">{pluralPhotos(t, day.photoCount)}</span>
                                                  </button>

                                                  {dayOpen && (
                                                    <div className="ml-5 mt-2 space-y-3 border-l border-line pl-3">
                                                      {day.sessions.map((session) => (
                                                        <SessionCard key={session.id} session={session} t={t} onOpenPhoto={setLightbox} />
                                                      ))}
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })
            )}
          </div>

          {lightbox && <PhotoLightbox src={lightbox.src} alt={lightbox.alt} label={lightbox.alt} t={t} onClose={() => setLightbox(null)} />}
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

type Translator = (s: string) => string;

function SessionCard({ session, t, onOpenPhoto }: { session: WoundSession; t: Translator; onOpenPhoto: (v: { src: string; alt: string }) => void }) {
  return (
    <div className="rounded-md border border-line bg-surface-muted p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs text-fg-faint">{formatDateTime(session.session_started_at)}</span>
        <AdminRecordControls kind="wound_session" id={session.id} />
      </div>
      <p className="mb-3 text-xs text-fg-faint">
        {t("Uploaded by")}: {session.uploader?.staff_name || session.uploaded_by_other || "--"}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {session.photos.map((photo) => (
          <PhotoTile key={photo.id} photo={photo} t={t} onOpen={() => onOpenPhoto({ src: `/api/wound-photos/${photo.id}`, alt: t(photo.body_part_label) })} />
        ))}
      </div>
    </div>
  );
}

// No <img> is mounted until this tile is clicked, so a closed branch costs
// nothing and an open one costs exactly the photos the user looked at.
// The fixed aspect box reserves the tile's space up front, so loading the
// image doesn't shift the grid around it.
function PhotoTile({ photo, t, onOpen }: { photo: WoundPhoto; t: Translator; onOpen: () => void }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <button
        type="button"
        onClick={() => {
          setLoaded(true);
          onOpen();
        }}
        aria-label={`${t("Open photo")}: ${t(photo.body_part_label)}`}
        className="group relative block aspect-[4/3] w-full cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
      >
        {loaded ? (
          // Same URL the lightbox requests, and the route sends
          // Cache-Control: private, max-age=3600 -- so the browser serves
          // the tile from cache rather than fetching the Drive bytes twice.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/wound-photos/${photo.id}`} alt={t(photo.body_part_label)} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-surface-muted text-fg-faint">
            <Images size={20} aria-hidden="true" />
            <span className="text-[11px]">{t("Click to load")}</span>
          </span>
        )}
      </button>
      <div className="p-2">
        <p className="text-xs font-medium text-fg">{t(photo.body_part_label)}</p>
        {photo.description && <p className="text-xs text-fg-subtle">{photo.description}</p>}
        <AdminRecordControls kind="wound_photo" id={photo.id} compact className="mt-2" />
      </div>
    </div>
  );
}

function PhotoLightbox({ src, alt, label, t, onClose }: { src: string; alt: string; label: string; t: Translator; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
      className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/70 p-4"
    >
      <div className="max-h-full max-w-4xl overflow-auto" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="max-h-[85vh] w-auto rounded-md" />
        <p className="mt-2 text-center text-xs text-white/80">{label}</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("Close")}
        className="absolute right-4 top-4 rounded-md bg-black/50 px-3 py-2 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        {t("Close")}
      </button>
    </div>
  );
}
