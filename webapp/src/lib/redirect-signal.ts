// When a Server Action finishes with redirect(), Next.js rejects the
// client-side `await action(...)` with a special error whose digest starts
// with "NEXT_REDIRECT" -- even though the save SUCCEEDED and the router is
// already navigating. Callers that report success/failure to the unsaved-
// changes dialog must treat this as success, or the dialog either hangs on
// "Saving..." forever or shows a false "Save failed" (and a retry duplicates
// the record). Checks the digest directly rather than importing Next's
// internal next/dist/... helper, which can move between versions.
export function isRedirectSignal(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}
