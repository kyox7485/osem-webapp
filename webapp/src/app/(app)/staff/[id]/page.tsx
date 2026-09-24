import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { formatBranch } from "@/lib/lookups";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";

export default async function StaffViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await getServerTranslator();
  const supabase = await createClient();
  const currentUser = await getCurrentUser();

  const { data: staff } = await supabase
    .from("tbl_staff")
    .select("*, tbl_positions(name), tbl_branches(locale:BranchLocale, code:BranchCode)")
    .eq("StaffID", id)
    .single();

  if (!staff) notFound();

  const position = Array.isArray(staff.tbl_positions) ? staff.tbl_positions[0] : staff.tbl_positions;
  const branch = Array.isArray(staff.tbl_branches) ? staff.tbl_branches[0] : staff.tbl_branches;

  return (
    <div>
      <PageTitle title={staff.staff_name} description={`${position?.name ?? ""} · ${formatBranch(branch)}`} />
      {isAdmin(currentUser) && (
        <div className="mb-4 flex items-center justify-end">
          <Link
            href={`/staff/${staff.StaffID}/edit`}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
          >
            {t("Edit")}
          </Link>
        </div>
      )}

      <div className="max-w-md rounded-md border border-line bg-surface p-4 shadow-sm">
        <dl className="space-y-2 text-sm">
          <Row label={t("Staff ID")} value={staff.StaffID} fallback={t("--")} />
          <Row label={t("Role")} value={staff.role ? t(staff.role) : staff.role} fallback={t("--")} />
          <Row label={t("Department")} value={staff.department ? t(staff.department) : staff.department} fallback={t("--")} />
          <Row label={t("Status")} value={staff.status ? t(staff.status) : staff.status} fallback={t("--")} />
        </dl>
      </div>
    </div>
  );
}

function Row({ label, value, fallback }: { label: string; value: string | null; fallback: string }) {
  return (
    <div>
      <dt className="text-xs text-fg-faint">{label}</dt>
      <dd className="text-fg">{value ?? fallback}</dd>
    </div>
  );
}
