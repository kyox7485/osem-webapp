import { createClient } from "@/lib/supabase/server";
import type { ReportBranchInfo } from "./report-shell";

// Same tbl_branches columns formatBranch()/getBranches() already read
// (PascalCase in the DB) -- adds BranchAddress/BranchContact for the report
// header, which the list-picker lookups don't need.
export async function getReportBranchInfo(branchId: number): Promise<ReportBranchInfo> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tbl_branches")
    .select("BranchName, BranchLocale, BranchAddress, BranchContact")
    .eq("BranchID", branchId)
    .single();

  return {
    branchName: data?.BranchName ?? "OSEM",
    branchLocale: data?.BranchLocale ?? "",
    branchAddress: data?.BranchAddress ?? null,
    branchContact: data?.BranchContact ?? null,
  };
}
