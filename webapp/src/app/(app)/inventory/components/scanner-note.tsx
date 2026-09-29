"use client";

import { useTranslation } from "@/components/language-provider";

/** Setup note for barcode scanners (D-109): collapsed by default, shown on the Setup pages. */
export function ScannerSetupNote() {
  const t = useTranslation();
  return (
    <details className="mt-3 max-w-2xl rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg-secondary">
      <summary className="cursor-pointer font-medium text-fg max-md:flex max-md:min-h-11 max-md:items-center">
        {t("Scanner setup")}
      </summary>
      <ul className="mt-2 list-disc space-y-1 pb-1 pl-5 text-xs">
        <li>{t("Use a USB or Bluetooth scanner in keyboard mode (keyboard-wedge / HID). It types the code as if from a keyboard.")}</li>
        <li>{t("Set the scanner to send Enter after each code (an Enter suffix). Without it the code is not picked up.")}</li>
        <li>{t("On Receive, Issue, Transfers, Counts and Charges you can scan without clicking a field first.")}</li>
        <li>{t("Products are found only by barcode or exact SKU. There is no search by name on these screens.")}</li>
        <li>{t("Camera scanning is not available yet.")}</li>
      </ul>
    </details>
  );
}
