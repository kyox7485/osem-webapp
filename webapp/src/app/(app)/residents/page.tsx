import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function ResidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("tbl_residents")
    .select("id, resident_name, ic_number, status, care_type, admission_date, tbl_branches(name)")
    .order("resident_name");

  if (q) {
    query = query.ilike("resident_name", `%${q}%`);
  }

  const { data: residents, error } = await query;

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

      <form className="mb-4">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by name..."
          className="w-full max-w-xs rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
        />
      </form>

      {error && <p className="text-sm text-red-600">{error.message}</p>}

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">IC</th>
              <th className="px-4 py-2 font-medium">Branch</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Care type</th>
              <th className="px-4 py-2 font-medium">Admitted</th>
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
                  <td className="px-4 py-2 text-gray-600">{branch?.name ?? "--"}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-2 text-gray-600">{r.care_type ?? "--"}</td>
                  <td className="px-4 py-2 text-gray-600">{r.admission_date ?? "--"}</td>
                </tr>
              );
            })}
            {residents?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
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
