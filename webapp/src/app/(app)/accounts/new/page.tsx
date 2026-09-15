import { redirect } from "next/navigation";
import { AccountForm } from "@/components/account-form";
import { getBranches, getStaffRoster } from "@/lib/lookups";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { createAccount } from "../actions";

export default async function NewAccountPage() {
  const currentUser = await getCurrentUser();
  if (!isAdmin(currentUser)) redirect("/accounts");

  const [branches, staffRoster] = await Promise.all([getBranches(), getStaffRoster()]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-gray-900">New account</h1>
      <AccountForm branches={branches} staffRoster={staffRoster} action={createAccount} />
    </div>
  );
}
