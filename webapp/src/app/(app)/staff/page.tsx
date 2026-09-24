import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { getBranches, getPositions, formatBranch } from "@/lib/lookups";
import { STAFF_STATUS_OPTIONS, STAFF_ROLE_OPTIONS, DEPARTMENT_OPTIONS } from "@/lib/types";
import { ColumnFilter } from "@/components/column-filter";
import { ClickableRow } from "@/components/clickable-row";
import { FilterPendingProvider } from "@/components/filter-pending";
import { NavButton } from "@/components/nav-button";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";

const DEFAULT_STATUSES = ["ACTIVE"];

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    position_id?: string;
    status?: string;
    branch_id?: string;
    role?: string;
    department?: string;
  }>;
}) {
  const { q, position_id, status, branch_id, role, department } = await searchParams;
  const { t } = await getServerTranslator();
  const currentUser = await getCurrentUser();
  const admin = isAdmin(currentUser);

  const [branches, positions] = await Promise.all([admin ? getBranches() : Promise.resolve([]), getPositions()]);

  const selectedStatuses = status !== undefined ? status.split(",").filter(Boolean) : DEFAULT_STATUSES;
  const selectedPositions = position_id !== undefined ? position_id.split(",").filter(Boolean) : positions.map((p) => String(p.id));
  const selectedBranches = admin && branch_id !== undefined ? branch_id.split(",").filter(Boolean) : null;
  const selectedRoles = role !== undefined ? role.split(",").filter(Boolean) : [...STAFF_ROLE_OPTIONS];
  const selectedDepartments = department !== undefined ? department.split(",").filter(Boolean) : [...DEPARTMENT_OPTIONS];

  const noResults =
    selectedStatuses.length === 0 ||
    selectedPositions.length === 0 ||
    selectedRoles.length === 0 ||
    selectedDepartments.length === 0 ||
    (selectedBranches !== null && selectedBranches.length === 0);

  let staff: {
    id: string;
    staff_name: string;
    role: string;
    department: string | null;
    status: string;
    tbl_positions: { name: string } | { name: string }[] | null;
    tbl_branches: { locale: string | null; code: string } | { locale: string | null; code: string }[] | null;
  }[] = [];
  let error: { message: string } | null = null;

  if (!noResults) {
    const supabase = await createClient();
    let query = supabase
      .from("tbl_staff")
      .select(
        "id:StaffID, staff_name, role, department, status, tbl_positions(name), tbl_branches(locale:BranchLocale, code:BranchCode)"
      )
      .order("staff_name")
      .in("status", selectedStatuses)
      .in("position_id", selectedPositions)
      .in("role", selectedRoles);

    if (selectedDepartments.length !== DEPARTMENT_OPTIONS.length) {
      query = query.in("department", selectedDepartments);
    }
    if (q) query = query.ilike("staff_name", `%${q}%`);

    if (admin) {
      if (selectedBranches) query = query.in("branch_id", selectedBranches);
    } else if (currentUser) {
      // Non-admin logins never see other branches' staff here -- no filter
      // control for it, this is fixed.
      query = query.eq("branch_id", currentUser.branch_id);
    }

    const result = await query;
    staff = result.data ?? [];
    error = result.error;
  }

  return (
    <div>
      <PageTitle title={t("Staff")} />
      {admin && (
        <div className="mb-6 flex items-center justify-end">
          <NavButton
            href="/staff/new"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 hover:shadow"
          >
            {t("New staff")}
          </NavButton>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error.message}</p>}

      <FilterPendingProvider>
        <div className="overflow-x-auto rounded-md border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs font-medium uppercase tracking-wide text-fg-subtle">
              <tr>
                <th className="px-4 py-2">
                  <ColumnFilter type="text" label={t("Name")} paramName="q" placeholder={t("Search by name...")} />
                </th>
                <th className="px-4 py-2">
                  <ColumnFilter
                    type="select"
                    label={t("Position")}
                    paramName="position_id"
                    options={positions.map((p) => ({ value: String(p.id), label: p.label }))}
                    defaultValues={positions.map((p) => String(p.id))}
                  />
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
                    label={t("Role")}
                    paramName="role"
                    options={STAFF_ROLE_OPTIONS.map((r) => ({ value: r, label: t(r) }))}
                    defaultValues={[...STAFF_ROLE_OPTIONS]}
                  />
                </th>
                <th className="px-4 py-2">
                  <ColumnFilter
                    type="select"
                    label={t("Department")}
                    paramName="department"
                    options={DEPARTMENT_OPTIONS.map((d) => ({ value: d, label: t(d) }))}
                    defaultValues={[...DEPARTMENT_OPTIONS]}
                  />
                </th>
                <th className="px-4 py-2">
                  <ColumnFilter
                    type="select"
                    label={t("Status")}
                    paramName="status"
                    options={STAFF_STATUS_OPTIONS.map((s) => ({ value: s, label: t(s) }))}
                    defaultValues={DEFAULT_STATUSES}
                  />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {staff.map((s) => {
                const position = Array.isArray(s.tbl_positions) ? s.tbl_positions[0] : s.tbl_positions;
                const branch = Array.isArray(s.tbl_branches) ? s.tbl_branches[0] : s.tbl_branches;
                return (
                  <ClickableRow key={s.id} href={`/staff/${s.id}`} className="hover:bg-hover">
                    <td className="px-4 py-2 font-medium text-fg">{s.staff_name}</td>
                    <td className="px-4 py-2 text-fg-muted">{position?.name ?? t("--")}</td>
                    {admin && <td className="px-4 py-2 text-fg-muted">{formatBranch(branch)}</td>}
                    <td className="px-4 py-2 text-fg-muted">{t(s.role)}</td>
                    <td className="px-4 py-2 text-fg-muted">{s.department ? t(s.department) : t("--")}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          s.status === "ACTIVE" ? "bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300" : "bg-surface-strong text-fg-secondary"
                        }`}
                      >
                        {t(s.status)}
                      </span>
                    </td>
                  </ClickableRow>
                );
              })}
              {staff.length === 0 && (
                <tr>
                  <td colSpan={admin ? 6 : 5} className="px-4 py-6 text-center text-fg-faint">
                    {t("No staff found.")}
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
