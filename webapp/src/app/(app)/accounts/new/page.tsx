import { redirect } from "next/navigation";
import { AccountForm } from "@/components/account-form";
import { BackButton } from "@/components/back-button";
import { getBranches } from "@/lib/lookups";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";
import { createAccount } from "../actions";

export default async function NewAccountPage() {
  const currentUser = await getCurrentUser();
  if (!isAdmin(currentUser)) redirect("/accounts");

  const { t } = await getServerTranslator();
  const branches = await getBranches();

  return (
    <div>
      <PageTitle title={t("New account")} />
      <BackButton />
      <div className="mt-4">
        <AccountForm branches={branches} action={createAccount} />
      </div>
    </div>
  );
}
