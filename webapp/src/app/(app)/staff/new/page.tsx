import { redirect } from "next/navigation";
import { StaffForm } from "@/components/staff-form";
import { BackButton } from "@/components/back-button";
import { getPositions, getBranches, getDemoBranchIds } from "@/lib/lookups";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";
import { createStaff } from "../actions";

export default async function NewStaffPage() {
  const { t } = await getServerTranslator();
  const currentUser = await getCurrentUser();
  // Spelled as a null check rather than canCreateStaff() so TypeScript narrows
  // currentUser for the branch_id read below -- the two are the same condition,
  // since canCreateStaff() admits every signed-in account.
  if (!currentUser) redirect("/staff");

  const [positions, allBranches, demoBranchIds] = await Promise.all([getPositions(), getBranches(), getDemoBranchIds()]);
  const isDemoUser = currentUser && demoBranchIds.includes(Number(currentUser.branch_id));
  const admin = isAdmin(currentUser);
  const branches = admin
    ? // DEMO branches stay hidden from everyone but the demo account itself.
      isDemoUser
      ? allBranches
      : allBranches.filter((b) => !demoBranchIds.includes(Number(b.id)))
    : // Non-admins get their own branch only -- createStaff re-derives this
      // from the session anyway, so this is presentation, not the guard.
      allBranches.filter((b) => Number(b.id) === currentUser.branch_id);

  return (
    <div>
      <PageTitle title={t("New staff")} />
      <BackButton />
      <div className="mt-4">
        <StaffForm positions={positions} branches={branches} isAdmin={admin} action={createStaff} />
      </div>
    </div>
  );
}
