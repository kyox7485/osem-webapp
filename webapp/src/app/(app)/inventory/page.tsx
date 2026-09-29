import { redirect } from "next/navigation";

export default async function InventoryIndex({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const { branch } = await searchParams;
  redirect(branch ? `/inventory/stock?branch=${encodeURIComponent(branch)}` : "/inventory/stock");
}
