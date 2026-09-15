// Quick-glance panel for a doctor reviewing this resident: static clinical
// background (history/medication/allergy, from tbl_residents) plus the most
// recent nursing-chart vitals and the last-ordered value of each progress
// note "plan" field. Plan fields are optional per note -- a doctor only
// fills in whatever's relevant on a given visit -- so "last dressing plan"
// means the most recent note where dressing_plan was actually set, not
// necessarily the most recent note overall.

type Vital = {
  entry_timestamp: string;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  heart_rate: number | null;
  temperature: number | null;
  spo2: number | null;
  spo2_condition: string | null;
};

type PlanEntry = { entry_timestamp: string; value: string } | null;

type Props = {
  allergy: string | null;
  pastMedicalCondition: string | null;
  currentMedicationList: string | null;
  vitals: Vital[];
  plans: {
    medical: PlanEntry;
    nursing: PlanEntry;
    diet: PlanEntry;
    dressing: PlanEntry;
    monitoring: PlanEntry;
    physio: PlanEntry;
  };
};

export function ResidentDashboard({ allergy, pastMedicalCondition, currentMedicationList, vitals, plans }: Props) {
  return (
    <div className="mb-6 space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <DashCard title="Medical / surgical history">
          <ClampedText value={pastMedicalCondition} />
        </DashCard>
        <DashCard title="Current medication list">
          <ClampedText value={currentMedicationList} />
        </DashCard>
        <DashCard title="Known allergy">
          <ClampedText value={allergy} />
        </DashCard>
      </div>

      <DashCard title="Recent vitals">
        {vitals.length === 0 ? (
          <EmptyNote text="No vitals recorded yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="py-1 pr-3">Date</th>
                  <th className="py-1 pr-3">BP</th>
                  <th className="py-1 pr-3">HR</th>
                  <th className="py-1 pr-3">Temp</th>
                  <th className="py-1 pr-3">SpO2</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {vitals.map((v, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-3 text-gray-500">{new Date(v.entry_timestamp).toLocaleString()}</td>
                    <td className="py-1 pr-3 text-gray-800">
                      {v.systolic_bp ?? "--"}/{v.diastolic_bp ?? "--"}
                    </td>
                    <td className="py-1 pr-3 text-gray-800">{v.heart_rate ?? "--"}</td>
                    <td className="py-1 pr-3 text-gray-800">{v.temperature ?? "--"}</td>
                    <td className="py-1 pr-3 text-gray-800">
                      {v.spo2 ?? "--"}
                      {v.spo2_condition ? ` (${v.spo2_condition})` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DashCard>

      <DashCard title="Last ordered plans">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <PlanRow label="Medical / treatment plan" entry={plans.medical} />
          <PlanRow label="Nursing plan" entry={plans.nursing} />
          <PlanRow label="Diet plan" entry={plans.diet} />
          <PlanRow label="Dressing plan" entry={plans.dressing} />
          <PlanRow label="Monitoring plan" entry={plans.monitoring} />
          <PlanRow label="Physio plan" entry={plans.physio} />
        </div>
      </DashCard>
    </div>
  );
}

function DashCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-bold text-gray-900">{title}</h2>
      {children}
    </div>
  );
}

function ClampedText({ value }: { value: string | null }) {
  if (!value) return <EmptyNote text="None recorded." />;
  return <p className="whitespace-pre-wrap text-sm text-gray-800">{value}</p>;
}

function PlanRow({ label, entry }: { label: string; entry: PlanEntry }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      {entry ? (
        <dd className="text-sm text-gray-800">
          {entry.value}
          <span className="block text-xs text-gray-400">{new Date(entry.entry_timestamp).toLocaleDateString()}</span>
        </dd>
      ) : (
        <dd className="text-sm text-gray-400">No entry yet</dd>
      )}
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <p className="text-sm text-gray-400">{text}</p>;
}
