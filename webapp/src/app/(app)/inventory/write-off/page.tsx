import { redirect } from "next/navigation";

// Merged into /inventory/issue; kept so old bookmarks still work.
export default async function Page({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const { branch } = await searchParams;
  redirect(`/inventory/issue?tab=write-off${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`);
}
