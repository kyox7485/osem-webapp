"use client";

import { FileDown } from "lucide-react";
import { useTranslation } from "@/components/language-provider";

// Opens the generated PDF in a new tab via a plain GET to /api/reports/* --
// the server streams the PDF straight from memory (see the route handlers),
// so there's no client-side blob/fetch handling needed and nothing is ever
// persisted server-side. Stops the click from bubbling into the parent
// card's own onClick (used everywhere these sit on an expandable card).
export function PdfDownloadLink({ href, label }: { href: string; label?: string }) {
  const t = useTranslation();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
    >
      <FileDown size={13} />
      {label ?? t("PDF")}
    </a>
  );
}
