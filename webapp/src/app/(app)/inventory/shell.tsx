import { redirect } from "next/navigation";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";
import { getInventoryContext, type InventoryContext } from "@/lib/inventory/server";
import { InventoryTabs } from "./inventory-tabs";
import { EmptyState } from "./components/form-bits";

/** Resolves the inventory context for a page or sends the user home. */
export async function requireInventory(searchParams: Promise<{ branch?: string }>): Promise<InventoryContext> {
  const { branch } = await searchParams;
  const ctx = await getInventoryContext(branch);
  if (!ctx) redirect("/");
  return ctx;
}

/** Page frame: title, module tabs, branch picker; blocks pages the rank cannot use. */
export async function InventoryShell({
  ctx,
  title,
  minRank = 1,
  children,
}: {
  ctx: InventoryContext;
  title: string;
  minRank?: number;
  children: React.ReactNode;
}) {
  const { t } = await getServerTranslator();
  return (
    <div>
      <PageTitle title={t("Inventory")} description={t(title)} />
      <InventoryTabs rank={ctx.rank} branches={ctx.branches} branchId={ctx.branchId} />
      {ctx.branchId === null ? (
        <EmptyState text={t("Inventory is not enabled for this branch yet.")} />
      ) : ctx.rank < minRank ? (
        <EmptyState text={t("You are not allowed to do this here.")} />
      ) : (
        children
      )}
    </div>
  );
}
