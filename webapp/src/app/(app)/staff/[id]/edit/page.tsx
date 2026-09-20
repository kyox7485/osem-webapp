import { notFound, redirect } from "next/navigation";
import { StaffForm } from "@/components/staff-form";
import { getPositions, getBranches, getDemoBranchIds } from "@/lib/lookups";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { createClient } from "@/lib/supabase/server";
import type { Staff } from "@/lib/types";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";
import { updateStaff } from "../../actions";

export default async function EditStaffPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getServerTranslator();
  const currentUser = await getCurrentUser();
  if (!isAdmin(currentUser)) redirect("/staff");

  const { id } = await params;
  const supabase = await createClient();

  const [{ data: staff }, positions, allBranches, demoBranchIds] = await Promise.all([
    supabase.from("tbl_staff").select("*").eq("StaffID", id).single(),
    getPositions(),
    getBranches(),
    getDemoBranchIds(),
  ]);
  const isDemoUser = currentUser && demoBranchIds.includes(Number(currentUser.branch_id));
  const branches = isDemoUser ? allBranches : allBranches.filter((b) => !demoBranchIds.includes(Number(b.id)));

  if (!staff) notFound();

  const boundAction = updateStaff.bind(null, staff.StaffID);

  return (
    <div>
      <PageTitle title={`${t("Edit")} ${staff.staff_name}`} />
      <StaffForm staff={staff as Staff} positions={positions} branches={branches} isAdmin={isAdmin(currentUser)} action={boundAction} />
    </div>
  );
}
