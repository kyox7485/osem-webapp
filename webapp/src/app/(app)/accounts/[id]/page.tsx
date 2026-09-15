import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { formatBranch } from "@/lib/lookups";

export default async function AccountViewPage({ params }: { params: Promise<{ id: string }> }) {
  const currentUser = await getCurrentUser();
  if (!isAdmin(currentUser)) redirect("/residents");

  const { id } = await params;
  const supabase = await createClient();

  const { data: account } = await supabase
    .from("tbl_user_accounts")
    .select("*, tbl_branches(locale:BranchLocale, code:BranchCode)")
    .eq("id", id)
    .single();

  if (!account) notFound();

  const branch = Array.isArray(account.tbl_branches) ? account.tbl_branches[0] : account.tbl_branches;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{account.username}</h1>
          <p className="text-sm text-gray-500">{account.email} · {formatBranch(branch)}</p>
        </div>
        <Link
          href={`/accounts/${account.id}/edit`}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
        >
          Edit
        </Link>
      </div>

      <div className="max-w-md rounded-md border border-gray-200 bg-white p-4 shadow-sm">
        <dl className="space-y-2 text-sm">
          <Row label="Rights" value={account.rights} />
          <Row label="Status" value={account.status} />
        </dl>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="text-gray-800">{value ?? "--"}</dd>
    </div>
  );
}
