import Link from "next/link";
import { getServerTranslator } from "@/lib/i18n/server";
import { INV_TIER } from "@/lib/inventory/core";
import { REPORTS, REPORT_TAB_KEYS, isReportKey } from "@/lib/inventory/reports/types";
import { InventoryShell, requireInventory } from "../shell";
import { SubTabs } from "../components/sub-tabs";
import { ReportSection } from "../components/report-section";

const LINK_CLS =
  "inline-flex items-center rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-fg-secondary hover:bg-hover";

// Reports (design section 9.5, Phase 7). Stock balance is the Stock page and
// Movement is the Ledger under Transactions, so those are links; the others
// are sub-tabs (?tab=<report>) with their own filters, on-screen table
// (500 rows), PDF and CSV. Each sub-tab shows only for ranks allowed to run it.
export default async function InventoryReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const ctx = await requireInventory(searchParams);
  const { t } = await getServerTranslator();

  const allowed = REPORT_TAB_KEYS.filter((k) => ctx.rank >= REPORTS[k].minRank).map((k) => ({ key: k, label: REPORTS[k].label }));
  const requested = typeof raw.tab === "string" ? raw.tab : "";
  const active = allowed.find((a) => a.key === requested && isReportKey(requested))?.key ?? allowed[0]?.key;
  const branchQuery = ctx.branchId ? `?branch=${ctx.branchId}` : "";

  return (
    <InventoryShell ctx={ctx} title="Reports">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-fg-subtle">{t("Also see:")}</span>
        <Link href={`/inventory/stock${branchQuery}`} className={LINK_CLS}>
          {t("Stock balance")}
        </Link>
        <Link href={`/inventory/transactions${branchQuery}`} className={LINK_CLS}>
          {t("Movement (Ledger)")}
        </Link>
        {ctx.rank >= INV_TIER.PERIOD_LOCK && (
          <Link href={`/inventory/month-end${branchQuery}`} className={LINK_CLS}>
            {t("Month-end exceptions")}
          </Link>
        )}
      </div>
      <SubTabs basePath="/inventory/reports" items={allowed} active={active ?? ""} branchId={ctx.branchId} />
      {active && <ReportSection key={`${ctx.branchId}-${active}`} ctx={ctx} report={active} raw={raw} action="/inventory/reports" hidden={{ tab: active }} />}
    </InventoryShell>
  );
}
