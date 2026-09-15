import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/current-user";

export default async function AccountsPage() {
  const currentUser = await getCurrentUser();
  if (!isAdmin(currentUser)) redirect("/residents");

  const supabase = await createClient();
  const { data: accounts, error } = await supabase
    .from("tbl_user_accounts")
    .select("id, email, username, rights, status, tbl_branches(name:BranchName)")
    .order("username");

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Accounts</h1>
          <p className="text-sm text-gray-500">Who can log in, and what they can do -- separate from the staff roster.</p>
        </div>
        <Link
          href="/accounts/new"
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
        >
          New account
        </Link>
      </div>

      {error && <p className="text-sm text-red-600">{error.message}</p>}

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Username</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Branch</th>
              <th className="px-4 py-2 font-medium">Rights</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {accounts?.map((a) => {
              const branch = Array.isArray(a.tbl_branches) ? a.tbl_branches[0] : a.tbl_branches;
              return (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <Link href={`/accounts/${a.id}`} className="font-medium text-gray-900 hover:underline">
                      {a.username}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-gray-600">{a.email}</td>
                  <td className="px-4 py-2 text-gray-600">{branch?.name ?? "--"}</td>
                  <td className="px-4 py-2 text-gray-600">{a.rights}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        a.status === "ACTIVE" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {a.status}
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
