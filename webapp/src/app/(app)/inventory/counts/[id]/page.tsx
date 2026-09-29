import Link from "next/link";
import { getServerTranslator } from "@/lib/i18n/server";
import {
  ADJUSTMENT_STATUS_LABELS,
  COUNT_STATUS_OPTIONS,
  COUNT_TYPE_OPTIONS,
  INV_TIER,
  LOCATION_KIND_OPTIONS,
  labelOf,
  type InvCountLineView,
} from "@/lib/inventory/core";
import { isDemoBranch, loadCatalogue, loadCountDetail, loadLocations, loadResidents, loadStaff } from "@/lib/inventory/server";
import { InventoryShell, requireInventory } from "../../shell";
import { CARD_CLS, EmptyState } from "../../components/form-bits";
import { CountStatusBadge } from "../status-badge";
import { CountEntry } from "./count-entry";
import { CountLinesTable } from "./count-lines-table";
import { CountReview } from "./count-review";

// One count. IN_PROGRESS: the blind sheet (no book quantity is even loaded).
// SUBMITTED: the review screen for the Head-Nurse tier, otherwise a blind
// read-only view. CLOSED / CANCELLED: read-only with the adjustment link.
export default async function InventoryCountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const ctx = await requireInventory(searchParams);
  const { id } = await params;
  const { t } = await getServerTranslator();
  const countId = Number(id);
  const branchId = ctx.branchId;
  const canReview = ctx.rank >= INV_TIER.COUNT_INVESTIGATE;

  const detail =
    branchId === null || ctx.rank < INV_TIER.COUNT || !Number.isSafeInteger(countId)
      ? null
      : await loadCountDetail(ctx.supabase, branchId, countId, canReview);
  if (!detail || branchId === null) {
    return (
      <InventoryShell ctx={ctx} title="Counts" minRank={INV_TIER.COUNT}>
        <EmptyState text={t("Count not found for this branch.")} />
      </InventoryShell>
    );
  }

  const { header } = detail;
  const demo = await isDemoBranch(branchId);
  const [catalogue, locations, staff, residents] = await Promise.all([
    loadCatalogue(ctx.supabase, { includeInactive: true }),
    loadLocations(ctx.supabase, branchId),
    loadStaff(ctx.supabase, branchId, demo),
    loadResidents(ctx.supabase, branchId, false),
  ]);
  const kind = locations.find((l) => l.id === header.locationId)?.kind ?? null;
  const productById = new Map(catalogue.products.map((p) => [p.id, p]));
  const residentName = new Map(residents.map((r) => [r.id, r.name]));
  const uomById = new Map(catalogue.uoms.map((u) => [u.id, u]));
  const lines: InvCountLineView[] = detail.lines.map((l) => {
    const p = productById.get(l.productId);
    const uom = p ? uomById.get(p.baseUomId) : undefined;
    return {
      id: l.id,
      productId: l.productId,
      name: p?.name ?? String(l.productId),
      sku: p?.sku ?? "",
      uomCode: uom?.code ?? "",
      allowFraction: uom?.allowFraction ?? false,
      residentName: l.residentId === null ? null : (residentName.get(l.residentId) ?? String(l.residentId)),
      isFound: l.isFound,
      physical: l.physical,
      expected: l.expected,
      postedSince: l.postedSince,
      variance: l.variance,
      note: l.note,
    };
  });

  const status = header.status;
  const showVariance = status === "CLOSED" || (status === "CANCELLED" && lines.some((l) => l.expected !== null)) || (status === "SUBMITTED" && canReview);
  const sameStaff = header.investigatedByStaff !== null && header.investigatedByStaff === header.countedByStaff;

  return (
    <InventoryShell ctx={ctx} title="Counts" minRank={INV_TIER.COUNT}>
      <div className="space-y-4">
        <Link href={`/inventory/counts?branch=${branchId}`} className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          {t("Back to counts")}
        </Link>
        <section className={`${CARD_CLS} flex flex-wrap items-center gap-x-4 gap-y-1 text-sm`}>
          <span className="text-base font-semibold text-fg">{header.countNo}</span>
          <CountStatusBadge status={status} label={t(labelOf(COUNT_STATUS_OPTIONS, status))} />
          <span className="text-fg-secondary">{kind ? t(labelOf(LOCATION_KIND_OPTIONS, kind)) : ""}</span>
          <span className="text-fg-subtle">{t(labelOf(COUNT_TYPE_OPTIONS, header.countType))}</span>
          <span className="text-fg-subtle">
            {t("Counted by")}: {header.countedByStaff}
          </span>
          <span className="text-fg-subtle">{(header.startedAt ?? "").slice(0, 10)}</span>
          {status === "IN_PROGRESS" && header.freezeLocation && (
            <span className="text-amber-700 dark:text-amber-300">{t("Location frozen")}</span>
          )}
        </section>

        {status === "IN_PROGRESS" ? (
          <CountEntry
            countId={header.id}
            branchId={branchId}
            isTransit={kind === "TRANSIT"}
            lines={lines}
            catalogue={catalogue}
            residents={residents}
            staff={staff}
          />
        ) : status === "SUBMITTED" && canReview ? (
          <CountReview countId={header.id} branchId={branchId} countedByStaff={header.countedByStaff} lines={lines} staff={staff} />
        ) : (
          <div className="space-y-4">
            {status === "SUBMITTED" && <EmptyState text={t("Submitted. Waiting for a Head Nurse to review the count.")} />}
            <CountLinesTable lines={lines} showVariance={showVariance} />
            {(status === "CLOSED" || status === "CANCELLED") && (
              <section className={`${CARD_CLS} space-y-2 text-sm`}>
                {header.investigatedByStaff && (
                  <p className="text-fg-secondary">
                    {t("Reviewed by")}: {header.investigatedByStaff}
                  </p>
                )}
                {status === "CANCELLED" && <p className="font-medium text-fg">{t("Cancelled")}</p>}
                {header.investigationSummary && (
                  <p className="whitespace-pre-wrap text-fg">
                    {status === "CANCELLED" ? `${t("Reason")}: ` : ""}
                    {header.investigationSummary}
                  </p>
                )}
                {status === "CLOSED" && sameStaff && (
                  <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                    {t("The same person counted and is reviewing this count.")}
                  </p>
                )}
                {detail.adjustments.length > 0 ? (
                  <ul className="space-y-1">
                    {detail.adjustments.map((a) => (
                      <li key={a.id}>
                        <Link
                          href={`/inventory/issue?tab=adjustments&branch=${branchId}`}
                          className="text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          {t("Adjustment")} {a.adjustmentNo}
                        </Link>{" "}
                        <span className="text-fg-subtle">({t(ADJUSTMENT_STATUS_LABELS[a.status] ?? a.status)})</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  status === "CLOSED" && <p className="text-fg-subtle">{t("No adjustment was requested for this count.")}</p>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </InventoryShell>
  );
}
