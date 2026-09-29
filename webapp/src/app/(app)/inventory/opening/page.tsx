import { redirect } from "next/navigation";

// Merged into /inventory/transactions; kept so old bookmarks still work.
export default async function Page({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const { branch } = await searchParams;
  redirect(`/inventory/transactions?tab=opening${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`);
}
