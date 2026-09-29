import { getServerTranslator } from "@/lib/i18n/server";
import { ADJUSTMENT_REASON_OPTIONS, ADJUSTMENT_STATUS_LABELS, INV_TIER, LOCATION_KIND_OPTIONS, formatQty, labelOf } from "@/lib/inventory/core";
import { isDemoBranch, loadCatalogue, loadLocations, loadResidents, loadStaff } from "@/lib/inventory/server";
import type { InventoryContext } from "@/lib/inventory/server";
import { EmptyState } from "../components/form-bits";
import { AdjustmentRequestForm } from "./request-form";
import { AdjustmentDecision } from "./decision";

type AdjRow = {
  id: number;
  adjustment_no: string;
  status: string;
  reason_code: string;
  justification: string;
  requested_by_staff: string;
  requested_by_account: number;
  decision_note: string | null;
  created_at: string;
  location_id: number;
  tbl_inv_adjustment_lines: { id: number; qty_delta_base: number; resident_id: number | null; tbl_inv_products: { name: string } | { name: string }[] | null }[];
};

// Adjustments (D-61): a Head-Nurse-tier request posts nothing; a MODERATOR or
// ADMIN on another login (and another staff member) approves it, which posts
// one ADJUSTMENT dated the approval day. The requester may cancel.
export async function AdjustmentsPanel({ ctx }: { ctx: InventoryContext }) {
  const { t } = await getServerTranslator();
  const branchId = ctx.branchId;
  if (branchId === null) return null;

  const demo = await isDemoBranch(branchId);
  const [locations, catalogue, staff, residents, adjRes] = await Promise.all([
    loadLocations(ctx.supabase, branchId),
    loadCatalogue(ctx.supabase),
    loadStaff(ctx.supabase, branchId, demo),
    loadResidents(ctx.supabase, branchId, false),
    ctx.supabase
      .from("tbl_inv_adjustments")
      .select(
        "id, adjustment_no, status, reason_code, justification, requested_by_staff, requested_by_account, decision_note, created_at, location_id, tbl_inv_adjustment_lines(id, qty_delta_base, resident_id, tbl_inv_products(name))"
      )
      .eq("branch_id", branchId)
      .order("id", { ascending: false })
      .limit(50),
  ]);
  const rows = (adjRes.data ?? []) as unknown as AdjRow[];
  const locationKind = new Map(locations.map((l) => [l.id, l.kind]));
  const residentName = new Map(residents.map((r) => [r.id, r.name]));
  const canApprove = ctx.rank >= INV_TIER.ADJUSTMENT_APPROVE;

  return (
    <div className="space-y-6">
        <AdjustmentRequestForm key={branchId} locations={locations} catalogue={catalogue} staff={staff} residents={residents} />
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-fg">{t("Requests")}</h2>
          {rows.length === 0 ? (
            <EmptyState text={t("No adjustment requests yet.")} />
          ) : (
            <ul className="divide-y divide-line-subtle rounded-lg border border-line bg-surface shadow-sm">
              {rows.map((a) => {
                const own = Number(a.requested_by_account) === ctx.account.id;
                return (
                  <li key={a.id} className="space-y-1 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-fg">{a.adjustment_no}</span>
                      <span className="rounded bg-surface-strong px-2 py-0.5 text-xs text-fg-secondary">{t(ADJUSTMENT_STATUS_LABELS[a.status] ?? a.status)}</span>
                      <span className="text-fg-subtle">{t(labelOf(ADJUSTMENT_REASON_OPTIONS, a.reason_code))}</span>
                      <span className="text-fg-subtle">{t(labelOf(LOCATION_KIND_OPTIONS, locationKind.get(Number(a.location_id)) ?? ""))}</span>
                      <span className="text-fg-subtle">{a.requested_by_staff}</span>
                    </div>
                    <p className="text-xs text-fg-secondary">{a.justification}</p>
                    <p className="text-xs text-fg-secondary">
                      {a.tbl_inv_adjustment_lines
                        .map((l) => {
                          const p = Array.isArray(l.tbl_inv_products) ? l.tbl_inv_products[0] : l.tbl_inv_products;
                          const who = l.resident_id ? ` (${residentName.get(Number(l.resident_id)) ?? l.resident_id})` : "";
                          return `${p?.name ?? "?"}${who} ${Number(l.qty_delta_base) > 0 ? "+" : ""}${formatQty(l.qty_delta_base)}`;
                        })
                        .join(", ")}
                    </p>
                    {a.decision_note && <p className="text-xs text-fg-subtle">{a.decision_note}</p>}
                    {a.status === "PENDING" && ((canApprove && !own) || own) && (
                      <AdjustmentDecision adjustmentId={a.id} staff={staff} canApprove={canApprove && !own} canCancel={own} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
    </div>
  );
}
