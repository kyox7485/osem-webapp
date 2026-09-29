import Link from "next/link";
import { getServerTranslator } from "@/lib/i18n/server";
import { COUNT_STATUS_OPTIONS, COUNT_TYPE_OPTIONS, INV_TIER, LOCATION_KIND_OPTIONS, labelOf } from "@/lib/inventory/core";
import { isDemoBranch, loadCounts, loadLocations, loadStaff } from "@/lib/inventory/server";
import { InventoryShell, requireInventory } from "../shell";
import { EmptyState } from "../components/form-bits";
import { CountStatusBadge } from "./status-badge";
import { StartCountForm } from "./start-count-form";

// Stock counts (D-60, D-104, D-123, D-159): a count never posts stock. It
// records the physical quantity blind, and a Head Nurse reviews the variance
// and (optionally) requests ONE adjustment, which a moderator then approves.
export default async function InventoryCountsPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const ctx = await requireInventory(searchParams);
  const { t } = await getServerTranslator();
  const branchId = ctx.branchId;
  if (branchId === null || ctx.rank < INV_TIER.COUNT) {
    return (
      <InventoryShell ctx={ctx} title="Counts" minRank={INV_TIER.COUNT}>
        {null}
      </InventoryShell>
    );
  }

  const demo = await isDemoBranch(branchId);
  const [locations, staff, counts] = await Promise.all([
    loadLocations(ctx.supabase, branchId),
    loadStaff(ctx.supabase, branchId, demo),
    loadCounts(ctx.supabase, branchId),
  ]);
  const locationLabel = new Map(locations.map((l) => [l.id, t(labelOf(LOCATION_KIND_OPTIONS, l.kind))]));

  return (
    <InventoryShell ctx={ctx} title="Counts" minRank={INV_TIER.COUNT}>
      <div className="space-y-6">
        <StartCountForm key={branchId} branchId={branchId} locations={locations} staff={staff} />
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-fg">{t("Counts")}</h2>
          {counts.length === 0 ? (
            <EmptyState text={t("No counts yet.")} />
          ) : (
            <ul className="divide-y divide-line-subtle rounded-lg border border-line bg-surface shadow-sm">
              {counts.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/inventory/counts/${c.id}?branch=${branchId}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-hover"
                  >
                    <span className="font-semibold text-fg">{c.countNo}</span>
                    <CountStatusBadge status={c.status} label={t(labelOf(COUNT_STATUS_OPTIONS, c.status))} />
                    <span className="text-fg-secondary">{locationLabel.get(c.locationId) ?? ""}</span>
                    <span className="text-fg-subtle">{t(labelOf(COUNT_TYPE_OPTIONS, c.countType))}</span>
                    <span className="text-fg-subtle">{c.countedByStaff}</span>
                    <span className="text-fg-subtle">{(c.startedAt ?? "").slice(0, 10)}</span>
                    <span className="text-fg-subtle">
                      {c.lineCount} {t("items")}
                    </span>
                    {c.status === "IN_PROGRESS" && c.freezeLocation && (
                      <span className="text-amber-700 dark:text-amber-300">{t("Location frozen")}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </InventoryShell>
  );
}
