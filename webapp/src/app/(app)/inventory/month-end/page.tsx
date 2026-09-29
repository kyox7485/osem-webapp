import Link from "next/link";
import { getServerTranslator } from "@/lib/i18n/server";
import {
  EXCEPTION_KIND_OPTIONS,
  INV_TIER,
  currentMonthKL,
  formatMoney,
  formatQty,
  isMonthParam,
  labelOf,
  nextMonthStart,
} from "@/lib/inventory/core";
import {
  isDemoBranch,
  loadBillingCodes,
  loadExceptions,
  loadPeriods,
  loadResidents,
  loadStaff,
} from "@/lib/inventory/server";
import { InventoryShell, requireInventory } from "../shell";
import { resolveSubTabs, type SubTabDef } from "../components/sub-page";
import { SubTabs } from "../components/sub-tabs";
import { EmptyState } from "../components/form-bits";
import { BillingCodesPanel } from "./billing-codes-panel";
import { ExportPanel } from "./export-panel";
import { MonthActions } from "./month-actions";

const TABS: SubTabDef[] = [
  { key: "month", label: "Month-end", minRank: INV_TIER.PERIOD_LOCK },
  { key: "codes", label: "Billing codes", minRank: INV_TIER.BILLING_CODES },
];

function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

// Month-end (D-108, D-116, D-122): review the exceptions, lock the month, export
// the charges for billing. Moderator and above.
export default async function InventoryMonthEndPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; month?: string; tab?: string }>;
}) {
  const ctx = await requireInventory(searchParams);
  const sp = await searchParams;
  const { t } = await getServerTranslator();
  const branchId = ctx.branchId;
  if (branchId === null || ctx.rank < INV_TIER.PERIOD_LOCK) {
    return (
      <InventoryShell ctx={ctx} title="Month-end" minRank={INV_TIER.PERIOD_LOCK}>
        {null}
      </InventoryShell>
    );
  }

  const today = currentMonthKL();
  const month = isMonthParam(sp.month) ? sp.month : previousMonth(today);
  const { allowed, active } = resolveSubTabs(TABS, ctx.rank, sp.tab);
  const demo = await isDemoBranch(branchId);
  const [periods, staff, residents] = await Promise.all([
    loadPeriods(ctx.supabase, branchId),
    loadStaff(ctx.supabase, branchId, demo),
    loadResidents(ctx.supabase, branchId, false),
  ]);

  if (active === "codes") {
    const codes = await loadBillingCodes(ctx.supabase, branchId);
    return (
      <InventoryShell ctx={ctx} title="Month-end" minRank={INV_TIER.PERIOD_LOCK}>
        <SubTabs basePath="/inventory/month-end" items={allowed} active={active} branchId={branchId} />
        <BillingCodesPanel
          key={branchId}
          residents={residents.map((r) => ({ ...r, code: codes.get(r.id) ?? "" }))}
        />
      </InventoryShell>
    );
  }

  const exceptions = await loadExceptions(ctx.supabase, branchId, month);
  const period = periods.find((p) => p.month.slice(0, 7) === month) ?? null;
  const residentName = new Map(residents.map((r) => [r.id, r.name]));
  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const who = (id: string | null) => (id ? (staffName.get(id) ?? id) : "");
  const blockingCount = exceptions.filter((e) => e.isBlocking).length;
  const monthEnded = nextMonthStart(month) <= `${today}-01`;

  const groups = EXCEPTION_KIND_OPTIONS.map((k) => ({
    ...k,
    rows: exceptions.filter((e) => e.kind === k.value),
  })).filter((g) => g.rows.length > 0);
  const link = (m: string) => `/inventory/month-end?tab=month&branch=${branchId}&month=${m}`;

  return (
    <InventoryShell ctx={ctx} title="Month-end" minRank={INV_TIER.PERIOD_LOCK}>
      <SubTabs basePath="/inventory/month-end" items={allowed} active={active} branchId={branchId} />
      <div className="space-y-6">
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-fg">{t("Billing months")}</h2>
          {periods.length === 0 ? (
            <EmptyState text={t("No billing months yet.")} />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-left text-xs text-fg-subtle">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("Month")}</th>
                    <th className="px-3 py-2 font-medium">{t("Status")}</th>
                    <th className="px-3 py-2 font-medium">{t("Exceptions reviewed")}</th>
                    <th className="px-3 py-2 font-medium">{t("Locked")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {periods.map((p) => {
                    const m = p.month.slice(0, 7);
                    return (
                      <tr key={p.id} className={m === month ? "bg-hover" : ""}>
                        <td className="px-3 py-2">
                          <Link href={link(m)} className="font-medium text-indigo-700 hover:underline dark:text-indigo-300">
                            {m}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={
                              p.status === "LOCKED"
                                ? "inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                                : "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                            }
                          >
                            {p.status === "LOCKED" ? t("Locked") : t("Open")}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-fg-secondary">
                          {p.reviewedAt ? `${p.reviewedAt.slice(0, 10)} · ${who(p.reviewedByStaff)}` : "-"}
                        </td>
                        <td className="px-3 py-2 text-fg-secondary">
                          {p.lockedAt ? `${p.lockedAt.slice(0, 10)} · ${who(p.lockedByStaff)}` : "-"}
                          {p.reopenCount > 0 && <span className="ml-2 text-xs text-fg-subtle">{t("Reopened")}: {p.reopenCount}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-fg">
            {t("Exceptions")} · {month}
          </h2>
          {exceptions.length === 0 ? (
            <EmptyState text={t("No exceptions this month.")} />
          ) : (
            groups.map((g) => (
              <div
                key={g.value}
                className={`overflow-x-auto rounded-lg border bg-surface shadow-sm ${
                  g.rows.some((r) => r.isBlocking) ? "border-red-300 dark:border-red-900" : "border-line"
                }`}
              >
                <div className="flex items-center gap-2 border-b border-line-subtle px-3 py-2 text-sm font-medium text-fg">
                  {t(g.label)}
                  <span className="text-fg-subtle">({g.rows.length})</span>
                  {g.rows.some((r) => r.isBlocking) && (
                    <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950/60 dark:text-red-300">
                      {t("Blocks the lock")}
                    </span>
                  )}
                </div>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-fg-subtle">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">{t("Date")}</th>
                      <th className="px-3 py-1.5 font-medium">{t("Reference")}</th>
                      <th className="px-3 py-1.5 font-medium">{t("Product")}</th>
                      <th className="px-3 py-1.5 font-medium">{t("Resident")}</th>
                      <th className="px-3 py-1.5 text-right font-medium">{t("Qty")}</th>
                      <th className="px-3 py-1.5 text-right font-medium">{t("Amount")}</th>
                      <th className="px-3 py-1.5 font-medium">{t("Performed by")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-subtle">
                    {g.rows.map((r) => (
                      <tr key={`${r.refType}-${r.refId}-${r.kind}`}>
                        <td className="whitespace-nowrap px-3 py-1.5 text-fg-secondary">{r.eventDate}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-fg">{r.reference}</td>
                        <td className="px-3 py-1.5 text-fg">{r.productName ?? ""}</td>
                        <td className="px-3 py-1.5 text-fg">{r.residentId !== null ? (residentName.get(r.residentId) ?? `#${r.residentId}`) : ""}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-fg-secondary">{r.qty !== null ? formatQty(r.qty) : ""}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-fg-secondary">{r.amount !== null ? `RM ${formatMoney(r.amount)}` : ""}</td>
                        <td className="px-3 py-1.5 text-fg-secondary">
                          {who(r.staff)}
                          {r.fromBranchLogin && (
                            <span className="ml-2 inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
                              {t("Posted from branch login")}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
          {/* kinds the view returns that the list above does not know would be silently hidden */}
          {exceptions.some((e) => labelOf(EXCEPTION_KIND_OPTIONS, e.kind) === e.kind) && (
            <p className="text-xs text-fg-subtle">{t("Some exception types are not shown in groups.")}</p>
          )}
        </section>

        {period ? (
          <MonthActions
            key={`${branchId}-${month}-${period.status}-${period.reviewedAt ?? ""}`}
            branchId={branchId}
            periodMonth={`${month}-01`}
            status={period.status}
            isReviewed={period.reviewedAt !== null}
            monthEnded={monthEnded}
            blockingCount={blockingCount}
            rank={ctx.rank}
            staff={staff}
          />
        ) : (
          <EmptyState text={t("Nothing has been posted in this month yet.")} />
        )}

        {ctx.rank >= INV_TIER.EXPORT && period && <ExportPanel key={`${branchId}-${month}`} branchId={branchId} month={month} />}
      </div>
    </InventoryShell>
  );
}
