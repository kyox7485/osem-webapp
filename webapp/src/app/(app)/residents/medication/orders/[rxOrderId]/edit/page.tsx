import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { getDemoBranchIds } from "@/lib/lookups";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";
import { ResidentsModuleTabs } from "../../../../module-tabs";
import { MedicationSubTabs } from "../../../medication-tabs";
import { OrderForm } from "../../order-form";

export default async function EditMedicationOrderPage({
  params,
}: {
  params: Promise<{ rxOrderId: string }>;
}) {
  const { t } = await getServerTranslator();
  const { rxOrderId } = await params;

  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/");

  const admin = isAdmin(currentUser);
  const supabase = await createClient();

  // ── Fetch order from Supabase mirror ──────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orderQ: any = supabase
    .from("tbl_medication_orders")
    .select(
      "id, external_ref_id, branch_id, resident_id, active_ingredient, brand_name, dosage_form, dose, unit, frequency, administration_times, dosing_days, indication, instruction, duration_type, start_date, end_date, noted_by, ordered_by, supplied_by, status, previous_order_id"
    )
    .eq("external_ref_id", rxOrderId)
    .single();
  const { data: orderRaw } = await orderQ;

  if (!orderRaw) notFound();

  // Access check
  if (!admin && orderRaw.branch_id !== currentUser.branch_id) {
    redirect("/residents/medication/orders");
  }

  if (admin) {
    const demoBranchIds = await getDemoBranchIds();
    const isDemoUser = demoBranchIds.includes(currentUser.branch_id);
    if (!isDemoUser && demoBranchIds.includes(orderRaw.branch_id)) {
      redirect("/residents/medication/orders");
    }
  }

  // ── Fetch resident for display ─────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const residentQ: any = supabase
    .from("tbl_residents")
    .select("resident_name, ResidentID")
    .eq("id", orderRaw.resident_id)
    .single();
  const { data: residentRaw } = await residentQ;

  const residentDisplay = residentRaw
    ? `${residentRaw.ResidentID ?? ""}${residentRaw.ResidentID ? " – " : ""}${residentRaw.resident_name}`
    : `Resident #${orderRaw.resident_id}`;

  // ── Map Supabase column names → form field names ───────────────────────────
  // Supabase mirror uses snake_case; the form uses camelCase matching the
  // OrderFormValues type.
  const initialValues = {
    dosageForm: orderRaw.dosage_form ?? "",
    brandName: orderRaw.brand_name ?? "",
    activeIngredient: orderRaw.active_ingredient ?? "",
    dose: orderRaw.dose !== null ? String(orderRaw.dose) : "",
    unit: orderRaw.unit ?? "",
    frequency: orderRaw.frequency ?? "",
    administrationTimes: orderRaw.administration_times ?? "",
    dosingDays: orderRaw.dosing_days ?? "",
    indication: orderRaw.indication ?? "",
    instruction: orderRaw.instruction ?? "",
    durationType: orderRaw.duration_type ?? "",
    startDate: orderRaw.start_date ?? "",
    endDate: orderRaw.end_date ?? "",
    notedBy: orderRaw.noted_by ?? "",
    orderedBy: orderRaw.ordered_by ?? "",
    suppliedBy: orderRaw.supplied_by ?? "",
    status: orderRaw.status ?? "Active",
    previousRxOrderId: "",
  };

  return (
    <div>
      <PageTitle title={t("Medication")} />
      <div className="mb-4">
        <ResidentsModuleTabs />
      </div>
      <div className="mb-6">
        <MedicationSubTabs />
      </div>

      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-800">{t("Edit Medication Order")}</h2>
      </div>

      <OrderForm
        mode="edit"
        rxOrderId={rxOrderId}
        residentDisplay={residentDisplay}
        initialValues={initialValues}
      />
    </div>
  );
}
