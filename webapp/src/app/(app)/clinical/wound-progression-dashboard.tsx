"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "@/components/language-provider";
import type { WoundBodyPart } from "./wound-body-diagram";
import type { WoundProgressionData, WoundProgressionFrequency } from "@/lib/wound-progression-data";
import { FileDown, ImageOff } from "lucide-react";

type Resident = { id: number; resident_name: string; branch_id: number };

type Props = {
  residents: Resident[];
  bodyParts: WoundBodyPart[];
  presetResidentId?: string;
};

const FREQUENCY_OPTIONS: { value: WoundProgressionFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

function defaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 3);
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: toIso(start), end: toIso(end) };
}

export function WoundProgressionDashboard({ residents, bodyParts, presetResidentId }: Props) {
  const t = useTranslation();
  const initialRange = defaultDateRange();

  const [residentId, setResidentId] = useState(presetResidentId || "");
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);
  const [frequency, setFrequency] = useState<WoundProgressionFrequency>("monthly");
  const [bodyPartFilter, setBodyPartFilter] = useState("");
  const [data, setData] = useState<WoundProgressionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!residentId || !start || !end) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ resident: residentId, start, end, frequency });
    if (bodyPartFilter) params.set("bodyPart", bodyPartFilter);

    fetch(`/api/wound-progression?${params.toString()}`)
      .then((res) => res.json())
      .then((result) => {
        if (cancelled) return;
        if (result.error) {
          setError(result.error);
          setData(null);
        } else {
          setData(result.data);
        }
      })
      .catch(() => {
        if (!cancelled) setError(t("Network error -- failed to load progression data"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [residentId, start, end, frequency, bodyPartFilter, t]);

  const pdfParams = new URLSearchParams({ resident: residentId, start, end, frequency });
  if (bodyPartFilter) pdfParams.set("bodyPart", bodyPartFilter);
  const hasResults = !!data && data.series.some((s) => s.buckets.length > 0);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t("Resident")}</label>
            <select value={residentId} onChange={(e) => setResidentId(e.target.value)} className="w-full rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm">
              <option value="">{t("Select resident")}</option>
              {residents.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.resident_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t("Start date")}</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="w-full rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t("End date")}</label>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t("Compare by")}</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as WoundProgressionFrequency)}
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm"
            >
              {FREQUENCY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.label)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t("Body part")}</label>
            <select value={bodyPartFilter} onChange={(e) => setBodyPartFilter(e.target.value)} className="w-full rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm">
              <option value="">{t("All body parts")}</option>
              {bodyParts.map((p) => (
                <option key={p.id} value={p.label}>
                  {t(p.label)}
                </option>
              ))}
            </select>
          </div>

          {/* No label above this cell -- the invisible spacer keeps the
              button's bottom edge lined up with the inputs beside it
              (grid stretches every cell in the row to equal height, then
              this cell's own flex pushes the button to that bottom edge),
              same alignment trick the Vital Signs filter bar already uses
              for its own action buttons. Always rendered (disabled rather
              than removed) so the toolbar never shifts height as results
              load in or out. */}
          <div className="flex flex-col justify-end">
            <span className="mb-1 hidden text-sm font-medium sm:block" aria-hidden="true">
              &nbsp;
            </span>
            {residentId && hasResults ? (
              <a
                href={`/api/reports/wound-progression?${pdfParams.toString()}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
              >
                <FileDown size={15} /> {t("Download PDF")}
              </a>
            ) : (
              <span
                title={t("Select a resident with wound photos in range to download the PDF report")}
                className="inline-flex cursor-not-allowed items-center justify-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 px-3 py-2 text-sm font-medium text-gray-400 dark:text-gray-500"
              >
                <FileDown size={15} /> {t("Download PDF")}
              </span>
            )}
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!residentId ? (
        <div className="rounded-md border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-400 dark:text-gray-500">
          {t("Select a resident to compare wound progression over time.")}
        </div>
      ) : loading ? (
        <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 text-center text-sm text-gray-400 dark:text-gray-500">{t("Loading...")}</div>
      ) : !hasResults ? (
        <div className="rounded-md border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-400 dark:text-gray-500">
          {t("No wound photos recorded for this resident in the selected period.")}
        </div>
      ) : (
        <div className="space-y-6">
          {data!.series.map((series) => (
            <div key={series.bodyPartLabel} className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-bold text-gray-900 dark:text-gray-100">{t(series.bodyPartLabel)}</h3>
              <div className="flex gap-4 overflow-x-auto pb-2">
                {series.buckets.map((bucket) => (
                  <div key={bucket.key} className="w-56 flex-shrink-0 rounded-md border border-gray-200 dark:border-gray-800 p-3">
                    <p className="mb-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300">{bucket.label}</p>

                    <div className="mb-2 grid grid-cols-2 gap-1.5">
                      {bucket.photos.slice(0, 4).map((photo) => (
                        <a key={photo.id} href={`/api/wound-photos/${photo.id}`} target="_blank" rel="noopener noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/wound-photos/${photo.id}`}
                            alt={bucket.label}
                            className="h-16 w-full rounded border border-gray-200 dark:border-gray-800 object-cover"
                            loading="lazy"
                          />
                        </a>
                      ))}
                      {bucket.photos.length === 0 && (
                        <div className="col-span-2 flex h-16 items-center justify-center rounded border border-dashed border-gray-200 dark:border-gray-800 text-gray-300">
                          <ImageOff size={18} />
                        </div>
                      )}
                    </div>
                    {bucket.photos.length > 4 && <p className="mb-2 text-[11px] text-gray-400 dark:text-gray-500">+{bucket.photos.length - 4} {t("more")}</p>}

                    {bucket.photos.some((p) => p.description) && (
                      <div className="mb-2 space-y-0.5">
                        {bucket.photos
                          .filter((p) => p.description)
                          .map((p) => (
                            <p key={p.id} className="text-[11px] text-gray-600 dark:text-gray-400">
                              {p.description}
                            </p>
                          ))}
                      </div>
                    )}

                    <div className="rounded border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 p-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{t("Dressing Plan")}</p>
                      <p className="text-[11px] text-gray-700 dark:text-gray-300">{bucket.dressingPlan?.text || t("No active plan on record")}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
