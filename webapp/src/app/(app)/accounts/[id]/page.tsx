import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/current-user";

export default async function AccountViewPage({ params }: { params: Promise<{ id: string }> }) {
  const currentUser = await getCurrentUser();
  if (!isAdmin(currentUser)) redirect("/residents");

  const { id } = await params;
  const supabase = await createClient();

  const { data: account } = await supabase
    .from("tbl_user_accounts")
    .select("*, tbl_branches(name), tbl_staff(staff_name)")
    .eq("id", id)
    .single();

  if (!account) notFound();

  const branch = Array.isArray(account.tbl_branches) ? account.tbl_branches[0] : account.tbl_branches;
  const staff = Array.isArray(account.tbl_staff) ? account.tbl_staff[0] : account.tbl_staff;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{account.username}</h1>
          <p className="text-sm text-gray-500">{account.email} · {branch?.name}</p>
        </div>
        <Link
          href={`/accounts/${account.id}/edit`}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
        >
          Edit
        </Link>
      </div>

      <div className="max-w-md rounded-md border border-gray-200 bg-white p-4">
        <dl className="space-y-2 text-sm">
          <Row label="Rights" value={account.rights} />
          <Row label="Status" value={account.status} />
          <Row label="Linked staff roster entry" value={staff?.staff_name ?? "-- none --"} />
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
