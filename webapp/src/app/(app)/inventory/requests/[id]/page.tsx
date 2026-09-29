import Link from "next/link";
import { getServerTranslator } from "@/lib/i18n/server";
import {
  INV_TIER,
  REQUEST_EVENT_LABELS,
  REQUEST_STATUS_OPTIONS,
  formatQty,
  labelOf,
  toPurchaseQty,
} from "@/lib/inventory/core";
import { isDemoBranch, loadCatalogue, loadStaff, loadSuppliers } from "@/lib/inventory/server";
import { InventoryShell, requireInventory } from "../../shell";
import { CARD_CLS, EmptyState } from "../../components/form-bits";
import { RequestStatusBadge } from "../status-badge";
import { RequestActions, type RequestLineView } from "./request-actions";

// One stock request: lines with requested / approved / delivered /
// outstanding (base and purchase UOM), the event log, and the actions the
// login may take (HQ review and "mark ordered" for MODERATOR+ on another
// login; submit / cancel / follow-up / close for the branch Head-Nurse tier).
export default async function InventoryRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const ctx = await requireInventory(searchParams);
  const { id } = await params;
  const { t } = await getServerTranslator();
  const requestId = Number(id);
  const branchId = ctx.branchId;

  const { data: req } =
    branchId === null || !Number.isSafeInteger(requestId)
      ? { data: null }
      : await ctx.supabase
          .from("tbl_inv_stock_requests")
          .select(
            "id, request_no, branch_id, status, requested_by_staff, created_by_account, created_at, submitted_at, reviewed_by_staff, reviewed_at, review_note, ordered_at, external_ref, expected_delivery_date"
          )
          .eq("id", requestId)
          .eq("branch_id", branchId)
          .maybeSingle();

  if (!req || branchId === null || ctx.rank < INV_TIER.STOCK_REQUEST) {
    return (
      <InventoryShell ctx={ctx} title="Stock requests" minRank={INV_TIER.STOCK_REQUEST}>
        <EmptyState text={t("Stock request not found for this branch.")} />
      </InventoryShell>
    );
  }

  const demo = await isDemoBranch(branchId);
  const [linesRes, progressRes, eventsRes, staff, suppliers, catalogue] = await Promise.all([
    ctx.supabase
      .from("tbl_inv_stock_request_lines")
      .select(
        "id, product_id, supplier_id, requested_qty, approved_qty, current_qty_snapshot, max_qty_snapshot, suggested_qty, closed_short_at, closed_short_reason, remarks"
      )
      .eq("request_id", requestId)
      .order("id"),
    ctx.supabase.from("v_inv_request_line_progress").select("line_id, received_qty, outstanding_qty").eq("request_id", requestId),
    ctx.supabase
      .from("tbl_inv_stock_request_events")
      .select("id, event, note, staff_id, created_at")
      .eq("request_id", requestId)
      .order("id"),
    loadStaff(ctx.supabase, branchId, demo),
    loadSuppliers(ctx.supabase, { includeInactive: true }),
    loadCatalogue(ctx.supabase, { includeInactive: true }),
  ]);

  if (linesRes.error || progressRes.error || eventsRes.error) {
    return (
      <InventoryShell ctx={ctx} title="Stock requests" minRank={INV_TIER.STOCK_REQUEST}>
        <EmptyState text={t("Could not load stock requests. Please refresh the page.")} />
      </InventoryShell>
    );
  }

  const progress = new Map((progressRes.data ?? []).map((p) => [Number(p.line_id), p]));
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const productById = new Map(catalogue.products.map((p) => [p.id, p]));
  const uomCode = new Map(catalogue.uoms.map((u) => [u.id, u.code]));
  const lines: RequestLineView[] = (linesRes.data ?? []).map((l) => {
    const p = productById.get(Number(l.product_id));
    const factor = p?.uoms.find((u) => u.uomId === p.purchaseUomId)?.factor ?? 1;
    const pr = progress.get(Number(l.id));
    return {
      id: Number(l.id),
      name: p?.name ?? "?",
      sku: p?.sku ?? "",
      baseCode: p ? (uomCode.get(p.baseUomId) ?? "") : "",
      purchaseCode: p ? (uomCode.get(p.purchaseUomId) ?? "") : "",
      factor,
      requested: Number(l.requested_qty),
      approved: l.approved_qty === null ? null : Number(l.approved_qty),
      received: Number(pr?.received_qty ?? 0),
      outstanding: Number(pr?.outstanding_qty ?? 0),
      closedShort: l.closed_short_at !== null,
      closedReason: l.closed_short_reason,
      supplier: l.supplier_id ? (supplierName.get(Number(l.supplier_id)) ?? null) : null,
      remarks: l.remarks,
    };
  });
  const qtyCell = (base: number | null, l: RequestLineView) =>
    base === null ? (
      "–"
    ) : (
      <>
        <span className="text-fg">
          {formatQty(base)} {l.baseCode}
        </span>
        {l.factor > 1 && (
          <span className="block text-xs text-fg-subtle">
            {formatQty(toPurchaseQty(base, l.factor))} {l.purchaseCode}
          </span>
        )}
      </>
    );

  return (
    <InventoryShell ctx={ctx} title="Stock requests" minRank={INV_TIER.STOCK_REQUEST}>
      <div className="space-y-4">
        <Link href={`/inventory/requests?branch=${branchId}&view=list`} className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          ← {t("All requests")}
        </Link>
        <div className={`${CARD_CLS} space-y-1 text-sm`}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-fg">{req.request_no}</h2>
            <RequestStatusBadge status={req.status} label={t(labelOf(REQUEST_STATUS_OPTIONS, req.status))} />
          </div>
          <p className="text-fg-secondary">
            {t("Requested by")}: {req.requested_by_staff} · {String(req.created_at).slice(0, 10)}
          </p>
          {req.reviewed_by_staff && (
            <p className="text-fg-secondary">
              {t("Reviewed by")}: {req.reviewed_by_staff} · {String(req.reviewed_at ?? "").slice(0, 10)}
              {req.review_note ? ` · ${req.review_note}` : ""}
            </p>
          )}
          {(req.external_ref || req.ordered_at) && (
            <p className="text-fg-secondary">
              {t("Order reference")}: {req.external_ref ?? "–"}
              {req.ordered_at ? ` · ${t("Ordered")} ${String(req.ordered_at).slice(0, 10)}` : ""}
            </p>
          )}
          {req.expected_delivery_date && (
            <p className="text-fg-secondary">
              {t("Expected delivery")}: {req.expected_delivery_date}
            </p>
          )}
        </div>

        <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs text-fg-subtle">
              <tr>
                <th className="px-3 py-2 font-medium">{t("Product")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("Requested")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("Approved")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("Delivered")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("Outstanding")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2 text-fg">
                    {l.name} <span className="text-xs text-fg-subtle">{l.sku}</span>
                    {l.supplier && <span className="block text-xs text-fg-subtle">{l.supplier}</span>}
                    {l.remarks && <span className="block text-xs text-fg-subtle">{l.remarks}</span>}
                    {l.closedShort && (
                      <span className="block text-xs text-amber-700 dark:text-amber-300">
                        {t("Closed short")}
                        {l.closedReason ? `: ${l.closedReason}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{qtyCell(l.requested, l)}</td>
                  <td className="px-3 py-2 text-right">{qtyCell(l.approved, l)}</td>
                  <td className="px-3 py-2 text-right">{qtyCell(l.received, l)}</td>
                  <td className="px-3 py-2 text-right font-medium">{qtyCell(l.outstanding, l)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <RequestActions
          key={`${req.id}-${req.status}`}
          requestId={Number(req.id)}
          status={req.status}
          lines={lines}
          staff={staff}
          suppliers={suppliers}
          canReview={ctx.rank >= INV_TIER.REQUEST_APPROVE && Number(req.created_by_account) !== ctx.account.id}
          canAct={ctx.rank >= INV_TIER.STOCK_REQUEST}
        />

        <section className={`${CARD_CLS} space-y-2`}>
          <h3 className="text-sm font-semibold text-fg">{t("History")}</h3>
          <ul className="space-y-1 text-sm">
            {(eventsRes.data ?? []).map((e) => (
              <li key={e.id} className="text-fg-secondary">
                <span className="text-fg-subtle">{String(e.created_at).slice(0, 16).replace("T", " ")}</span>{" "}
                <span className="font-medium text-fg">{t(REQUEST_EVENT_LABELS[e.event] ?? e.event)}</span>
                {e.staff_id ? ` · ${e.staff_id}` : ""}
                {e.note ? ` · ${e.note}` : ""}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </InventoryShell>
  );
}
