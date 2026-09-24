import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";
import { AccountsTable } from "./accounts-table";

export default async function AccountsPage() {
  const currentUser = await getCurrentUser();
  if (!isAdmin(currentUser)) redirect("/residents");

  const { t } = await getServerTranslator();

  const supabase = await createClient();
  const { data: accounts, error } = await supabase
    .from("tbl_user_accounts")
    .select("id, email, username, rights, status, tbl_branches(locale:BranchLocale, code:BranchCode)")
    .order("username");

  return (
    <div>
      <PageTitle title={t("Accounts")} />
      <div className="mb-6 flex items-center justify-end">
        <Link
          href="/accounts/new"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 hover:shadow"
        >
          {t("New account")}
        </Link>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p>}

      <AccountsTable accounts={accounts ?? []} />
    </div>
  );
}
