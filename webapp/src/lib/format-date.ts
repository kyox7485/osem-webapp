// Pinned locale + timeZone rather than plain toLocaleString()/
// toLocaleDateString() -- those default to the runtime's ambient locale,
// which differs between the Node server (SSR) and the browser (hydration),
// causing a React hydration mismatch wherever this text renders inside a
// Client Component tree.
const TIME_ZONE = "Asia/Kuala_Lumpur";

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// Month name for grouped headings (e.g. "September 2026"). Pinned to
// en-GB for the same hydration reason as above, and derived from klParts()
// so the month always agrees with formatDate()'s day/year rather than
// being re-read in the runtime's ambient zone.
export function formatMonthYear(iso: string): string {
  const { y, mo } = klParts(iso);
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, 1));
  return date.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

// For <input type="datetime-local"> -- that control has no timezone concept,
// it's a plain "wall clock" string, so we treat it as Asia/Kuala_Lumpur local
// time throughout (matching every other timestamp in this app).
function klParts(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute") };
}

export function toDatetimeLocalValue(iso: string): string {
  const { y, mo, d, h, mi } = klParts(iso);
  return `${y}-${mo}-${d}T${h}:${mi}`;
}

// Reverse of the above -- Malaysia has no DST, so +08:00 is always correct.
export function fromDatetimeLocalValue(value: string): string {
  return `${value}:00+08:00`;
}
