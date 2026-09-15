import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentStaff, isAdmin } from "@/lib/current-staff";

export default async function StaffPage() {
  const supabase = await createClient();
  const currentStaff = await getCurrentStaff();

  const { data: staff, error } = await supabase
    .from("tbl_staff")
    .select("id, staff_name, role, status, tbl_positions(name), tbl_branches(name)")
    .order("staff_name");

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Staff</h1>
        {isAdmin(currentStaff) && (
          <Link
            href="/staff/new"
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
          >
            New staff
          </Link>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error.message}</p>}

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Position</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Branch</th>
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
                  <td className="px-4 py-2 text-gray-600">{s.role}</td>
                  <td className="px-4 py-2 text-gray-600">{branch?.name ?? "--"}</td>
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
          </tbody>
        </table>
      </div>
    </div>
  );
}
