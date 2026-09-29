import { FileDown, FileText } from "lucide-react";
import { filterQuery } from "@/lib/inventory/reports/params";
import type { FilterKey, ReportKey, ReportParams } from "@/lib/inventory/reports/types";

// CSV and PDF links for the current (already validated) filters. Plain
// anchors to the export route: the PDF opens in a new tab, the CSV downloads.

const LINK =
  "inline-flex items-center gap-2 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-fg-secondary hover:bg-hover";

export function ExportButtons({
  report,
  filters,
  params,
  branchId,
  labels,
}: {
  report: ReportKey;
  filters: FilterKey[];
  params: ReportParams;
  branchId: number;
  labels: { csv: string; pdf: string };
}) {
  const href = (format: "csv" | "pdf") => {
    const qs = filterQuery(params, filters);
    qs.set("branch", String(branchId));
    qs.set("format", format);
    return `/api/inventory/reports/${report}?${qs.toString()}`;
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={href("pdf")} target="_blank" rel="noopener" className={LINK}>
        <FileText className="h-4 w-4" aria-hidden />
        {labels.pdf}
      </a>
      <a href={href("csv")} download className={LINK}>
        <FileDown className="h-4 w-4" aria-hidden />
        {labels.csv}
      </a>
    </div>
  );
}
