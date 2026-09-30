"use client";

import { useState, useEffect } from "react";
import { formatDateTime } from "@/lib/format-date";
import { PdfDownloadLink } from "@/components/pdf-download-link";
import { AdminRecordControls } from "@/components/admin-record-controls";
import { X } from "lucide-react";

export type ProgressNoteRow = {
  id: number;
  entry_timestamp: string;
  progress_note: string | null;
  physical_examination: string | null;
  medical_plan: string | null;
  nursing_plan: string | null;
  feeding_plan: string | null;
  monitoring_plan: string | null;
  dressing_plan: string | null;
  physio_plan: string | null;
  reviewed_by?: string | null;
  reviewed_by_other?: string | null;
  created_by?: string | null;
  created_by_other?: string | null;
  reviewer?: { StaffID: string; staff_name: string } | null;
  author?: { StaffID: string; staff_name: string } | null;
  /** Pre-computed author display name (resident page passes this). */
  authorName?: string;
  /** Resident name for multi-resident views. */
  residentName?: string;
};

type Props = {
  notes: ProgressNoteRow[];
  t: (key: string) => string;
  /** Show the latest-values summary above the timeline. Default: true. */
  showLatestStatus?: boolean;
};

function getNoteAuthor(note: ProgressNoteRow): string {
  if (note.authorName) return note.authorName;
  return (
    note.reviewer?.staff_name ??
    note.reviewed_by_other ??
    note.author?.staff_name ??
    note.created_by_other ??
    "--"
  );
}

type ColumnDef = { key: keyof ProgressNoteRow; label: string };

const COLUMNS: ColumnDef[] = [
  { key: "progress_note", label: "Progress Note" },
  { key: "physical_examination", label: "Physical Examination" },
  { key: "medical_plan", label: "Medical / Treatment Plan" },
  { key: "nursing_plan", label: "Nursing Plan" },
  { key: "feeding_plan", label: "Feeding / Diet Plan" },
  { key: "dressing_plan", label: "Dressing Plan" },
  { key: "monitoring_plan", label: "Monitoring Plan" },
  { key: "physio_plan", label: "Physio Plan" },
];

export function ProgressNotesTimeline({ notes, t, showLatestStatus = true }: Props) {
  const [selectedNote, setSelectedNote] = useState<ProgressNoteRow | null>(null);

  // Close detail modal on Escape
  useEffect(() => {
    if (!selectedNote) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedNote(null);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [selectedNote]);

  const latestNote = notes[0] ?? null;

  if (notes.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-line-strong p-6 text-center text-sm text-fg-faint">
        {t("No progress notes yet.")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Latest Clinical Status ───────────────────────────────────────── */}
      {showLatestStatus && latestNote && (
        <div className="rounded-md border border-line bg-surface p-4 shadow-sm">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            {t("Latest Clinical Status")}
          </h3>
          <p className="mb-3 text-xs text-fg-faint">
            {t("Latest note")}: {formatDateTime(latestNote.entry_timestamp)}
            <span className="mx-2">·</span>
            {t("Entered By")}: {getNoteAuthor(latestNote)}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {COLUMNS.map(({ key, label }) => {
              const value = latestNote[key] as string | null;
              return (
                <div key={key}>
                  <p className="mb-0.5 text-xs font-medium text-fg-subtle">{t(label)}</p>
                  {value ? (
                    <p className="line-clamp-3 whitespace-pre-wrap text-sm text-fg">{value}</p>
                  ) : (
                    <p className="text-xs italic text-fg-faint">{t("No information recorded")}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Desktop matrix (md+) ─────────────────────────────────────────── */}
      <div className="hidden md:block">
        {/* overflow-auto is scoped here so only this section scrolls horizontally */}
        <div className="max-h-[68vh] overflow-auto rounded-md border border-line shadow-sm">
          <table className="min-w-full border-collapse text-sm">
            <thead className="sticky top-0 z-20">
              <tr className="border-b border-line bg-surface-muted">
                <th
                  scope="col"
                  className="sticky left-0 z-30 min-w-[148px] bg-surface-muted px-3 py-2 text-left text-xs font-semibold text-fg-subtle whitespace-nowrap"
                >
                  {t("Date/Time")}
                </th>
                {COLUMNS.map(({ key, label }) => (
                  <th
                    key={key}
                    scope="col"
                    className="min-w-[160px] px-3 py-2 text-left text-xs font-semibold text-fg-subtle whitespace-nowrap"
                  >
                    {t(label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {notes.map((note) => (
                <tr
                  key={note.id}
                  className="group border-b border-line last:border-0 transition-colors hover:bg-hover"
                >
                  {/* Sticky date + actions column */}
                  <td className="sticky left-0 z-10 bg-surface px-3 py-3 align-top transition-colors group-hover:bg-hover">
                    <button
                      type="button"
                      onClick={() => setSelectedNote(note)}
                      className="block text-left"
                    >
                      <span className="text-xs font-medium text-fg-secondary hover:text-indigo-600 dark:hover:text-indigo-400">
                        {formatDateTime(note.entry_timestamp)}
                      </span>
                    </button>
                    {note.residentName && (
                      <p className="mt-0.5 text-xs font-medium text-fg-muted">{note.residentName}</p>
                    )}
                    <p className="mt-0.5 text-xs text-fg-faint">{getNoteAuthor(note)}</p>
                    <div className="mt-1.5 flex items-center gap-1">
                      <PdfDownloadLink href={`/api/reports/progress-note?id=${note.id}`} />
                      <AdminRecordControls
                        kind="progress_note"
                        id={note.id}
                        compact
                        onDeleted={() => setSelectedNote(null)}
                      />
                    </div>
                  </td>

                  {/* Data columns */}
                  {COLUMNS.map(({ key }) => {
                    const value = note[key] as string | null;
                    return (
                      <td
                        key={key}
                        className="max-w-[220px] cursor-pointer px-3 py-3 align-top"
                        onClick={() => setSelectedNote(note)}
                      >
                        {value ? (
                          <p className="line-clamp-3 whitespace-pre-wrap text-sm text-fg">{value}</p>
                        ) : (
                          <span className="text-xs text-fg-faint">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Mobile cards (< md) ──────────────────────────────────────────── */}
      <div className="space-y-2 md:hidden">
        {notes.map((note) => (
          <div key={note.id} className="rounded-md border border-line bg-surface shadow-sm">
            <div className="flex items-start justify-between px-4 pt-3 pb-2">
              <button
                type="button"
                onClick={() => setSelectedNote(note)}
                className="min-w-0 text-left"
              >
                <p className="text-sm font-medium text-fg">{formatDateTime(note.entry_timestamp)}</p>
                {note.residentName && (
                  <p className="text-xs font-medium text-fg-muted">{note.residentName}</p>
                )}
                <p className="text-xs text-fg-faint">{getNoteAuthor(note)}</p>
              </button>
              <div className="ml-2 flex shrink-0 items-center gap-1">
                <PdfDownloadLink href={`/api/reports/progress-note?id=${note.id}`} />
                <AdminRecordControls
                  kind="progress_note"
                  id={note.id}
                  compact
                  onDeleted={() => setSelectedNote(null)}
                />
              </div>
            </div>
            {note.progress_note && (
              <div className="border-t border-line px-4 py-2">
                <p className="mb-0.5 text-xs font-medium text-fg-subtle">{t("Progress Note")}</p>
                <p className="line-clamp-3 whitespace-pre-wrap text-sm text-fg">{note.progress_note}</p>
              </div>
            )}
            <div className="border-t border-line px-4 py-2">
              <button
                type="button"
                onClick={() => setSelectedNote(note)}
                className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
              >
                {t("View full note")} →
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Detail modal ─────────────────────────────────────────────────── */}
      {selectedNote && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedNote(null);
          }}
          role="dialog"
          aria-modal="true"
          aria-label={t("Note Details")}
        >
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border border-line bg-surface shadow-xl">
            {/* Modal header */}
            <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-line bg-surface px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg">{t("Note Details")}</p>
                <p className="text-xs text-fg-faint">
                  {formatDateTime(selectedNote.entry_timestamp)}
                  {selectedNote.residentName && (
                    <>
                      <span className="mx-1">·</span>
                      {selectedNote.residentName}
                    </>
                  )}
                  <span className="mx-1">·</span>
                  {getNoteAuthor(selectedNote)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <PdfDownloadLink href={`/api/reports/progress-note?id=${selectedNote.id}`} />
                <AdminRecordControls
                  kind="progress_note"
                  id={selectedNote.id}
                  onDeleted={() => setSelectedNote(null)}
                />
                <button
                  type="button"
                  onClick={() => setSelectedNote(null)}
                  className="rounded p-1 text-fg-faint hover:bg-surface-muted hover:text-fg"
                  aria-label={t("Close")}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal body */}
            <div className="space-y-4 p-4">
              {COLUMNS.map(({ key, label }) => {
                const value = selectedNote[key] as string | null;
                return (
                  <div key={key}>
                    <p className="mb-1 text-xs font-semibold text-fg-subtle">{t(label)}</p>
                    {value ? (
                      <p className="whitespace-pre-wrap text-sm text-fg">{value}</p>
                    ) : (
                      <p className="text-xs italic text-fg-faint">{t("No information recorded")}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
