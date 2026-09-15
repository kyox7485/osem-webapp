import { redirect } from "next/navigation";
import { AccountForm } from "@/components/account-form";
import { BackButton } from "@/components/back-button";
import { getBranches } from "@/lib/lookups";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { createAccount } from "../actions";

export default async function NewAccountPage() {
  const currentUser = await getCurrentUser();
  if (!isAdmin(currentUser)) redirect("/accounts");

  const branches = await getBranches();

  return (
    <div>
      <BackButton />
      <h1 className="mb-4 text-lg font-semibold text-gray-900">New account</h1>
      <AccountForm branches={branches} action={createAccount} />
    </div>
  );
}
