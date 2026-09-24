"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NewObservationChartForm } from "./new-observation-chart-form";
import { ObservationReviewDashboard } from "./observation-review-dashboard";
import type { LookupOption } from "@/lib/types";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { ListChecks, Plus } from "lucide-react";
import type { ObservationEntry } from "./observation-chart-actions";
import type { ObservationStatusRow } from "./observation-status-actions";

type Props = {
  entries: ObservationEntry[];
  activeEpisodes: ObservationStatusRow[];
  completedEpisodes: ObservationStatusRow[];
  allStaff: (LookupOption & { branch_id: number })[];
  currentStart: string;
  currentEnd: string;
  error: string | null;
};

export function ObservationChartModule({ entries, activeEpisodes, completedEpisodes, allStaff, currentStart, currentEnd, error }: Props) {
  const router = useRouter();
  const t = useTranslation();
  const { guardedAction } = useSafeNavigation();
  const [innerTab, setInnerTab] = useState<"review" | "new">("review");

  // New Entry may only target a resident who currently has an active
  // observation episode -- staff start observation from the Resident List,
  // never implicitly by filling this form.
  const activeResidents = activeEpisodes
    .filter((ep) => ep.tbl_residents)
    .map((ep) => ({
      id: ep.tbl_residents!.id,
      resident_name: ep.tbl_residents!.resident_name,
      branch_id: ep.tbl_residents!.branch_id,
    }));

  return (
    <div className="space-y-4">
      <TabRow>
        <TabButton icon={ListChecks} size="sm" active={innerTab === "review"} onClick={() => guardedAction(() => setInnerTab("review"))}>
          {t("Review Notes")}
        </TabButton>
        <TabButton icon={Plus} size="sm" active={innerTab === "new"} onClick={() => guardedAction(() => setInnerTab("new"))}>
          {t("New Entry")}
        </TabButton>
      </TabRow>

      {innerTab === "review" ? (
        <ObservationReviewDashboard
          entries={entries}
          activeEpisodes={activeEpisodes}
          completedEpisodes={completedEpisodes}
          currentStart={currentStart}
          currentEnd={currentEnd}
          error={error}
        />
      ) : activeResidents.length === 0 ? (
        <div className="rounded-md border border-dashed border-line-strong p-6 text-center text-sm text-fg-faint">
          {t("No residents are currently under observation. Start observation from the Resident List first.")}
        </div>
      ) : (
        <NewObservationChartForm
          residents={activeResidents}
          allStaff={allStaff}
          onSaved={() => {
            setInnerTab("review");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
