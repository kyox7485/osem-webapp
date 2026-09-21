import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";
import { ResidentsModuleTabs } from "../../module-tabs";
import { MedicationSubTabs } from "../medication-tabs";

export default async function MedicationOrdersPage() {
  const { t } = await getServerTranslator();

  return (
    <div>
      <PageTitle title={t("Medication")} />
      <div className="mb-4">
        <ResidentsModuleTabs />
      </div>
      <div className="mb-6">
        <MedicationSubTabs />
      </div>
      <div className="rounded-md border border-gray-200 bg-white px-6 py-10 text-center shadow-sm">
        <h2 className="mb-2 text-base font-semibold text-gray-700">{t("Medication Orders")}</h2>
        <p className="text-sm text-gray-400">{t("Coming soon.")}</p>
      </div>
    </div>
  );
}
