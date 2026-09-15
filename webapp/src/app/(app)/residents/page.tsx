import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { getBranches } from "@/lib/lookups";
import { RESIDENT_STATUS_OPTIONS } from "@/lib/types";

const inputCls =
  "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-gray-500 focus:outline-none";

export default async function ResidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; ic?: string; status?: string; branch_id?: string }>;
}) {
  const { q, ic, status, branch_id } = await searchParams;
  const currentUser = await getCurrentUser();
  const admin = isAdmin(currentUser);
  const effectiveStatus = status ?? "ACTIVE"; // default filter

  const supabase = await createClient();
  let query = supabase
    .from("tbl_residents")
    .select("id, resident_name, ic_number, status, tbl_branches(name)")
    .order("resident_name");

  if (q) query = query.ilike("resident_name", `%${q}%`);
  if (ic) query = query.ilike("ic_number", `%${ic}%`);
  if (effectiveStatus !== "ALL") query = query.eq("status", effectiveStatus);

  if (admin) {
    // Admins can see/filter across branches; only apply a branch filter if
    // they actually picked one.
    if (branch_id) query = query.eq("branch_id", branch_id);
  } else if (currentUser) {
    // Non-admin logins (branch emails, possibly shared) never see other
    // branches here -- there's no filter control for it, this is fixed.
    query = query.eq("branch_id", currentUser.branch_id);
  }

  const [{ data: residents, error }, branches] = await Promise.all([
    query,
    admin ? getBranches() : Promise.resolve([]),
  ]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Residents</h1>
        <Link
          href="/residents/new"
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
        >
          New resident
        </Link>
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm text-gray-700">
          Name
          <input type="text" name="q" defaultValue={q} placeholder="Search by name..." className={`mt-1 block ${inputCls}`} />
        </label>
        <label className="text-sm text-gray-700">
          IC
          <input type="text" name="ic" defaultValue={ic} placeholder="Search by IC..." className={`mt-1 block ${inputCls}`} />
        </label>
        <label className="text-sm text-gray-700">
          Status
          <select name="status" defaultValue={effectiveStatus} className={`mt-1 block ${inputCls}`}>
            <option value="ALL">All</option>
            {RESIDENT_STATUS_OPTIONS.map((s) => (
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
              <th className="px-4 py-2 font-medium">IC</th>
              {admin && <th className="px-4 py-2 font-medium">Branch</th>}
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {residents?.map((r) => {
              const branch = Array.isArray(r.tbl_branches) ? r.tbl_branches[0] : r.tbl_branches;
              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <Link href={`/residents/${r.id}`} className="font-medium text-gray-900 hover:underline">
                      {r.resident_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-gray-600">{r.ic_number ?? "--"}</td>
                  {admin && <td className="px-4 py-2 text-gray-600">{branch?.name ?? "--"}</td>}
                  <td className="px-4 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              );
            })}
            {residents?.length === 0 && (
              <tr>
                <td colSpan={admin ? 4 : 3} className="px-4 py-6 text-center text-gray-400">
                  No residents found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: "bg-green-100 text-green-800",
    DISCHARGED: "bg-gray-100 text-gray-700",
    DECEASED: "bg-red-100 text-red-800",
    "TRANSFERRED OUT": "bg-yellow-100 text-yellow-800",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? "bg-gray-100 text-gray-700"}`}>
      {status}
    </span>
  );
}
