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
