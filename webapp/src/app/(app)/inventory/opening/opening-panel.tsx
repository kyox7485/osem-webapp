import { getServerTranslator } from "@/lib/i18n/server";
import { INV_TIER } from "@/lib/inventory/core";
import { isDemoBranch, loadCatalogue, loadLocations, loadResidents, loadStaff } from "@/lib/inventory/server";
import type { InventoryContext } from "@/lib/inventory/server";
import { OpeningForm } from "./opening-form";

// Opening balance (ADMIN, D-117): only within opening_window_days of the
// branch go-live date, always dated go-live, and per product only while it
// has no other movements. Cost is entered per entered unit.
export async function OpeningPanel({ ctx }: { ctx: InventoryContext }) {
  const { t } = await getServerTranslator();
  const branchId = ctx.branchId;
  const data =
    branchId === null || ctx.rank < INV_TIER.OPENING_BALANCE
      ? null
      : await Promise.all([
          loadLocations(ctx.supabase, branchId),
          loadCatalogue(ctx.supabase),
          isDemoBranch(branchId).then((demo) => loadStaff(ctx.supabase, branchId, demo)),
          loadResidents(ctx.supabase, branchId),
          ctx.supabase.from("tbl_inv_branch_settings").select("go_live_date, opening_window_days").eq("branch_id", branchId).maybeSingle(),
        ]);
  const settings = data?.[4].data as { go_live_date: string | null; opening_window_days: number } | null | undefined;

  return (
    data && (
        <div className="space-y-3">
          <p className="text-sm text-fg-secondary">
            {t("Go-live date")}: <span className="font-semibold text-fg">{settings?.go_live_date ?? "—"}</span>.{" "}
            {t("Opening balances are accepted within {days} days of go-live and are dated on go-live.", {
              days: settings?.opening_window_days ?? 0,
            })}
          </p>
          <OpeningForm key={branchId} locations={data[0]} catalogue={data[1]} staff={data[2]} residents={data[3]} />
        </div>
    )
  );
}
