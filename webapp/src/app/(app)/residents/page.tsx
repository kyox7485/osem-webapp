import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { getBranches, formatBranch, getDemoBranchIds } from "@/lib/lookups";
import { RESIDENT_STATUS_OPTIONS } from "@/lib/types";
import { ColumnFilter } from "@/components/column-filter";
import { ClickableRow } from "@/components/clickable-row";
import { FilterPendingProvider } from "@/components/filter-pending";
import { NavButton } from "@/components/nav-button";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";
import { ResidentsModuleTabs } from "./module-tabs";

const DEFAULT_STATUSES = ["ACTIVE"];

export default async function ResidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; ic?: string; status?: string; branch_id?: string }>;
}) {
  const { t } = await getServerTranslator();
  const { q, ic, status, branch_id } = await searchParams;
  const currentUser = await getCurrentUser();
  const admin = isAdmin(currentUser);

  const selectedStatuses = status !== undefined ? status.split(",").filter(Boolean) : DEFAULT_STATUSES;
  const selectedBranches = admin && branch_id !== undefined ? branch_id.split(",").filter(Boolean) : null;

  const [allBranches, demoBranchIds] = admin
    ? await Promise.all([getBranches(), getDemoBranchIds()])
    : [[], [] as number[]];
  const isDemoUser = demoBranchIds.includes(currentUser?.branch_id ?? -1);
  const excludedBranchIds = isDemoUser ? [] : demoBranchIds;
  // Real admins never see demo branches in the filter or results.
  // The DEMO account (isDemoUser) sees all branches including its own.
  const branches = allBranches.filter((b) => !excludedBranchIds.includes(Number(b.id)));
  const noResults = selectedStatuses.length === 0 || (selectedBranches !== null && selectedBranches.length === 0);

  let residents: {
    id: number;
    resident_name: string;
    ic_number: string | null;
    status: string;
    tbl_branches: { locale: string | null; code: string } | { locale: string | null; code: string }[] | null;
  }[] = [];
  let error: { message: string } | null = null;

  if (!noResults) {
    const supabase = await createClient();
    let query = supabase
      .from("tbl_residents")
      .select("id, resident_name, ic_number, status, tbl_branches(locale:BranchLocale, code:BranchCode)")
      .order("resident_name")
      .in("status", selectedStatuses);

    if (q) query = query.ilike("resident_name", `%${q}%`);
    if (ic) query = query.ilike("ic_number", `%${ic}%`);

    if (admin) {
      if (selectedBranches) query = query.in("branch_id", selectedBranches);
      if (excludedBranchIds.length > 0) query = query.not("branch_id", "in", `(${excludedBranchIds.join(",")})`);
    } else if (currentUser) {
      // Non-admin logins (branch emails, possibly shared) never see other
      // branches here -- there's no filter control for it, this is fixed.
      query = query.eq("branch_id", currentUser.branch_id);
    }

    const result = await query;
    residents = result.data ?? [];
    error = result.error;
  }

  return (
    <div>
      <PageTitle title={t("Residents")} />
      <div className="mb-4">
        <ResidentsModuleTabs />
      </div>
      <div className="mb-6 flex items-center justify-end">
        <NavButton
          href="/residents/new"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 hover:shadow"
        >
          {t("New resident")}
        </NavButton>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error.message}</p>}

      <FilterPendingProvider>
        <div className="overflow-x-auto rounded-md border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">
                  <ColumnFilter type="text" label={t("Name")} paramName="q" placeholder={t("Search by name...")} />
                </th>
                <th className="px-4 py-2">
                  <ColumnFilter type="text" label={t("IC")} paramName="ic" placeholder={t("Search by IC...")} />
                </th>
                {admin && (
                  <th className="px-4 py-2">
                    <ColumnFilter
                      type="select"
                      label={t("Branch")}
                      paramName="branch_id"
                      options={branches.map((b) => ({ value: String(b.id), label: b.label }))}
                      defaultValues={branches.map((b) => String(b.id))}
                    />
                  </th>
                )}
                <th className="px-4 py-2">
                  <ColumnFilter
                    type="select"
                    label={t("Status")}
                    paramName="status"
                    options={RESIDENT_STATUS_OPTIONS.map((s) => ({ value: s, label: t(s) }))}
                    defaultValues={DEFAULT_STATUSES}
                  />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {residents.map((r) => {
                const branch = Array.isArray(r.tbl_branches) ? r.tbl_branches[0] : r.tbl_branches;
                return (
                  <ClickableRow key={r.id} href={`/residents/${r.id}`} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-900">{r.resident_name}</td>
                    <td className="px-4 py-2 text-gray-600">{r.ic_number ?? "--"}</td>
                    {admin && <td className="px-4 py-2 text-gray-600">{formatBranch(branch)}</td>}
                    <td className="px-4 py-2">
                      <StatusBadge status={r.status} label={t(r.status)} />
                    </td>
                  </ClickableRow>
                );
              })}
              {residents.length === 0 && (
                <tr>
                  <td colSpan={admin ? 4 : 3} className="px-4 py-6 text-center text-gray-400">
                    {t("No residents found.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </FilterPendingProvider>
    </div>
  );
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const colors: Record<string, string> = {
    ACTIVE: "bg-green-100 text-green-800",
    DISCHARGED: "bg-gray-100 text-gray-700",
    DECEASED: "bg-red-100 text-red-800",
    "TRANSFERRED OUT": "bg-yellow-100 text-yellow-800",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? "bg-gray-100 text-gray-700"}`}>
      {label}
    </span>
  );
}
