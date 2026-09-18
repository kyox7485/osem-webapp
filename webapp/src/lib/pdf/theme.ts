// Shared visual language for every printable clinical report. Kept as plain
// tokens (not Tailwind) because @react-pdf/renderer builds its own PDF object
// graph -- it doesn't read CSS/Tailwind classes at all.
export const pdfColors = {
  ink900: "#0f172a",
  ink700: "#334155",
  ink500: "#64748b",
  ink400: "#94a3b8",
  border: "#e2e8f0",
  borderStrong: "#cbd5e1",
  band: "#f1f5f9",
  bandStrong: "#e8ecf3",
  accent: "#4338ca", // indigo-700 -- matches the app's own primary (indigo-600) but a touch darker for print contrast
  accentSoft: "#eef2ff",
  white: "#ffffff",
  critical: "#dc2626",
  criticalSoft: "#fef2f2",
  warning: "#c2410c",
  warningSoft: "#fff7ed",
} as const;

export const pdfSpacing = {
  page: 32,
  section: 10,
  field: 6,
} as const;
