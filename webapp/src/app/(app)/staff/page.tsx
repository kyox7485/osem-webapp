import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { getBranches, getPositions } from "@/lib/lookups";
import { STAFF_STATUS_OPTIONS, STAFF_ROLE_OPTIONS, DEPARTMENT_OPTIONS } from "@/lib/types";
import { ColumnFilter } from "@/components/column-filter";

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
    tbl_branches: { name: string } | { name: string }[] | null;
  }[] = [];
  let error: { message: string } | null = null;

  if (!noResults) {
    const supabase = await createClient();
    let query = supabase
      .from("tbl_staff")
      .select("id:StaffID, staff_name, role, department, status, tbl_positions(name), tbl_branches(name:BranchName)")
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
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Staff</h1>
        {admin && (
          <Link
            href="/staff/new"
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
          >
            New staff
          </Link>
        )}
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error.message}</p>}

      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2">
                <ColumnFilter type="text" label="Name" paramName="q" placeholder="Search by name..." />
              </th>
              <th className="px-4 py-2">
                <ColumnFilter
                  type="select"
                  label="Position"
                  paramName="position_id"
                  options={positions.map((p) => ({ value: String(p.id), label: p.label }))}
                  defaultValues={positions.map((p) => String(p.id))}
                />
              </th>
              {admin && (
                <th className="px-4 py-2">
                  <ColumnFilter
                    type="select"
                    label="Branch"
                    paramName="branch_id"
                    options={branches.map((b) => ({ value: String(b.id), label: b.label }))}
                    defaultValues={branches.map((b) => String(b.id))}
                  />
                </th>
              )}
              <th className="px-4 py-2">
                <ColumnFilter
                  type="select"
                  label="Role"
                  paramName="role"
                  options={STAFF_ROLE_OPTIONS.map((r) => ({ value: r, label: r }))}
                  defaultValues={[...STAFF_ROLE_OPTIONS]}
                />
              </th>
              <th className="px-4 py-2">
                <ColumnFilter
                  type="select"
                  label="Department"
                  paramName="department"
                  options={DEPARTMENT_OPTIONS.map((d) => ({ value: d, label: d }))}
                  defaultValues={[...DEPARTMENT_OPTIONS]}
                />
              </th>
              <th className="px-4 py-2">
                <ColumnFilter
                  type="select"
                  label="Status"
                  paramName="status"
                  options={STAFF_STATUS_OPTIONS.map((s) => ({ value: s, label: s }))}
                  defaultValues={DEFAULT_STATUSES}
                />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {staff.map((s) => {
              const position = Array.isArray(s.tbl_positions) ? s.tbl_positions[0] : s.tbl_positions;
              const branch = Array.isArray(s.tbl_branches) ? s.tbl_branches[0] : s.tbl_branches;
              return (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <Link href={`/staff/${s.id}`} className="font-medium text-gray-900 hover:underline">
                      {s.staff_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-gray-600">{position?.name ?? "--"}</td>
                  {admin && <td className="px-4 py-2 text-gray-600">{branch?.name ?? "--"}</td>}
                  <td className="px-4 py-2 text-gray-600">{s.role}</td>
                  <td className="px-4 py-2 text-gray-600">{s.department ?? "--"}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        s.status === "ACTIVE" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {s.status}
                    </span>
                  </td>
                </tr>
              );
            })}
            {staff.length === 0 && (
              <tr>
                <td colSpan={admin ? 6 : 5} className="px-4 py-6 text-center text-gray-400">
                  No staff found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
