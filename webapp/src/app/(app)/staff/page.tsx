import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { getBranches, getPositions } from "@/lib/lookups";
import { STAFF_STATUS_OPTIONS } from "@/lib/types";

const inputCls =
  "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-gray-500 focus:outline-none";

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; position_id?: string; status?: string; branch_id?: string }>;
}) {
  const { q, position_id, status, branch_id } = await searchParams;
  const currentUser = await getCurrentUser();
  const admin = isAdmin(currentUser);
  const effectiveStatus = status ?? "ACTIVE"; // default filter

  const supabase = await createClient();
  let query = supabase
    .from("tbl_staff")
    .select("id, staff_name, status, tbl_positions(id, name), tbl_branches(name)")
    .order("staff_name");

  if (q) query = query.ilike("staff_name", `%${q}%`);
  if (position_id) query = query.eq("position_id", position_id);
  if (effectiveStatus !== "ALL") query = query.eq("status", effectiveStatus);

  if (admin) {
    if (branch_id) query = query.eq("branch_id", branch_id);
  } else if (currentUser) {
    // Non-admin logins never see other branches' staff here -- no filter
    // control for it, this is fixed.
    query = query.eq("branch_id", currentUser.branch_id);
  }

  const [{ data: staff, error }, branches, positions] = await Promise.all([
    query,
    admin ? getBranches() : Promise.resolve([]),
    getPositions(),
  ]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Staff</h1>
        {admin && (
          <Link
            href="/staff/new"
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
          >
            New staff
          </Link>
        )}
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm text-gray-700">
          Name
          <input type="text" name="q" defaultValue={q} placeholder="Search by name..." className={`mt-1 block ${inputCls}`} />
        </label>
        <label className="text-sm text-gray-700">
          Position
          <select name="position_id" defaultValue={position_id ?? ""} className={`mt-1 block ${inputCls}`}>
            <option value="">All positions</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-700">
          Status
          <select name="status" defaultValue={effectiveStatus} className={`mt-1 block ${inputCls}`}>
            <option value="ALL">All</option>
            {STAFF_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        {admin && (
          <label className="text-sm text-gray-700">
            Branch
            <select name="branch_id" defaultValue={branch_id ?? ""} className={`mt-1 block ${inputCls}`}>
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
          </label>
        )}
        <button
          type="submit"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Filter
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error.message}</p>}

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Position</th>
              {admin && <th className="px-4 py-2 font-medium">Branch</th>}
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {staff?.map((s) => {
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
            {staff?.length === 0 && (
              <tr>
                <td colSpan={admin ? 4 : 3} className="px-4 py-6 text-center text-gray-400">
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
