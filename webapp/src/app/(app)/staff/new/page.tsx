import { redirect } from "next/navigation";
import { StaffForm } from "@/components/staff-form";
import { BackButton } from "@/components/back-button";
import { getPositions, getBranches } from "@/lib/lookups";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";
import { createStaff } from "../actions";

export default async function NewStaffPage() {
  const { t } = await getServerTranslator();
  const currentUser = await getCurrentUser();
  if (!isAdmin(currentUser)) redirect("/staff");

  const [positions, branches] = await Promise.all([getPositions(), getBranches()]);

  return (
    <div>
      <PageTitle title={t("New staff")} />
      <BackButton />
      <div className="mt-4">
        <StaffForm positions={positions} branches={branches} isAdmin={isAdmin(currentUser)} action={createStaff} />
      </div>
    </div>
  );
}
