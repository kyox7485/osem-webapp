"use client";

import { QRCodeSVG } from "qrcode.react";

type QrCodeProps = {
  value: string;
  label: string;
  size?: number;
};

export function QrCode({ value, label, size = 104 }: QrCodeProps) {
  return (
    <div
      role="img"
      aria-label={label}
      className="shrink-0 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-2"
    >
      <QRCodeSVG value={value} size={size} />
    </div>
  );
}
