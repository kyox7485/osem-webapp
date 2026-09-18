import { notFound, redirect } from "next/navigation";
import { AccountForm } from "@/components/account-form";
import { SetPasswordForm } from "@/components/set-password-form";
import { getBranches } from "@/lib/lookups";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { createClient } from "@/lib/supabase/server";
import type { UserAccount } from "@/lib/types";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";
import { updateAccount } from "../../actions";

export default async function EditAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const currentUser = await getCurrentUser();
  if (!isAdmin(currentUser)) redirect("/accounts");

  const { t } = await getServerTranslator();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: account }, branches] = await Promise.all([
    supabase.from("tbl_user_accounts").select("*").eq("id", id).single(),
    getBranches(),
  ]);

  if (!account) notFound();

  const boundAction = updateAccount.bind(null, account.id);

  return (
    <div className="space-y-6">
      <PageTitle title={`${t("Edit")} ${account.username}`} />
      <div>
        <AccountForm account={account as UserAccount} branches={branches} action={boundAction} />
      </div>
      <SetPasswordForm accountId={account.id} />
    </div>
  );
}
