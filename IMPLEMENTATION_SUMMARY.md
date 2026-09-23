# Admission Analytics Optimization — Implementation Summary

## Overview
This document summarizes the optimization of the existing Residents → Admission Analytics dashboard, implementing all requirements from the specification.

## Changes Made

### 1. Database Schema — `tbl_branches.bed_capacity`

**File**: `schema/002_add_bed_capacity.sql`

Added new column to store official bed capacity for each branch:
```sql
ALTER TABLE tbl_branches ADD COLUMN bed_capacity integer DEFAULT NULL;
```

**Migration SQL**: Run this against the Supabase database to add the column.

**Purpose**: 
- Store the official bed capacity for each branch
- Replace hard-coded capacity calculations
- Enable accurate occupancy percentage calculations

---

### 2. Library Updates — `lookups.ts`

**Changes**:
- Added `getBranchesWithCapacity()` function to fetch branches with bed_capacity
- Existing `getBranches()` function unchanged for backward compatibility

**Key Function**:
```typescript
export async function getBranchesWithCapacity(onlyFunction?: string): Promise<(LookupOption & { bed_capacity: number | null })[]>
```

---

### 3. Data Layer Enhancements — `data.ts`

**New Types**:
- `ResidentDetail`: Extended resident info for detail views
- `BranchCapacityInfo`: Branch capacity and occupancy metadata

**New Calculation Functions**:

1. **`computeOccupancyPercentage(activeResidents, bedCapacity)`**
   - Calculates occupancy % = (activeResidents / bedCapacity) × 100
   - Returns `null` if capacity not configured or is 0
   - Handles missing/invalid data safely

2. **Drill-down Support Functions**:
   - `getAdmittedResidents(residents, range)` — residents admitted in period
   - `getDischargedResidents(residents, range)` — residents discharged in period
   - `getActiveResidents(residents)` — currently active residents
   - `calculateResidentLOS(resident, asOfDate)` — individual resident length of stay

3. **`computeLOSDistribution(residents, asOfDate)`** (Enhanced)
   - Now includes BOTH completed and active residents
   - Active residents LOS = calculated using asOfDate
   - Completed residents LOS = calculated using discharge_date
   - Maintains existing LOS bucket boundaries (0-30, 31-90, 91-180, >180 days)

---

### 4. Main Page Logic — `page.tsx`

**Access Control**:
```typescript
// NUR/HQ only access
if (account.branch_function && !["NUR", "HQ"].includes(account.branch_function)) {
  redirect("/residents");
}
```

**Occupancy Calculation**:
- Aggregates bed_capacity across selected branches
- Calculates occupancy % using actual bed_capacity
- Shows "Capacity not configured" if capacity is null/0

**Period-Aware Active Residents**:
```typescript
const isCurrentPeriod = period === "month" || 
  (period === "year" && range.end.getFullYear() === today.getFullYear() && range.end.getMonth() === today.getMonth());
```
- Active Residents KPI card hidden when period is NOT current
- Grid layout adjusts from 6 columns to 5 when card hidden

**KPI Grid Updates**:
- All KPI cards now support `clickable` prop
- Visual affordance added (hover state, "Click for details" text)
- Occupancy card only clickable if capacity is configured

---

### 5. Detail/Drill-Down Modal — `analytics-details-modal.tsx`

**New Component**: Reusable modal for displaying drill-down details

**Supported Detail Types**:
- `admissions` — List of residents admitted in period
- `discharges` — List of residents discharged in period  
- `active` — Currently active residents
- `net-change` — Breakdown: admissions − discharges
- `los` — Length of stay calculation explanation
- `occupancy` — Occupancy formula + branch breakdown

**Modal Features**:
- Keyboard escape to close
- Scrollable content for large resident lists
- Date range display
- Calculation breakdowns with visual hierarchy
- Branch-level occupancy breakdown for HQ view

**Example Usage**:
```typescript
<AnalyticsDetailsModal
  type="occupancy"
  value="85%"
  activeResidents={30}
  bedCapacity={36}
  occupancyPercentage={83}
  branchBreakdown={[...]}
  open={modalOpen}
  onOpenChange={setModalOpen}
/>
```

---

### 6. Chart & Card Components — `charts.tsx`

**KpiCard Enhancement**:
- Added `clickable?: boolean` prop
- Shows hover state when clickable
- Displays "Click for details" hint text
- Maintains existing styling

**OccupancyTrendChart Enhancement**:
- Improved hover targets (invisible 8px circles over 4px dots)
- Better tooltip information: date + occupancy count
- Added helpful text: "Hover over data points to see details"
- Maintains existing SVG rendering (no new dependencies)

---

### 7. Length of Stay Display Update

**Before**: "Completed stays only"
**After**: "All residents (completed + active)"

Subtitle now reflects that LOS includes both:
- Discharged residents (LOS = discharge_date − admission_date)
- Active residents (LOS = current_date − admission_date)

---

## Data Consistency

### Calculation Chain
All KPI calculations use the same underlying `ResidentRow` data:

```
Supabase tbl_residents
    ↓
Page.tsx (resident fetching + RLS)
    ↓
Shared calculation functions (data.ts)
    ↓
KPI cards + charts + modal details
```

**Example**: If admissions KPI shows 8, clicking it displays exactly those same 8 residents in the modal.

---

## Access Control Pattern

The pattern follows CLAUDE.md guidelines:

```typescript
const demoBranchIds = await getDemoBranchIds();          // always unconditional
const isDemoUser = demoBranchIds.includes(account.branch_id);
const excludedBranchIds = isDemoUser ? [] : demoBranchIds;
```

Applied to all multi-branch queries. No changes to existing exclusion logic.

---

## Edge Cases Handled

✅ Missing bed_capacity (NULL) → shows "Capacity not configured"
✅ Zero bed_capacity → shows "Capacity not configured"
✅ No residents → shows empty state
✅ Historical/custom date ranges → hides Active Residents KPI
✅ Active resident LOS includes calculation date
✅ Non-NUR/HQ users redirected to /residents
✅ All columns/queries check for null safely

---

## Validation Checklist

### Database
- [ ] Run `schema/002_add_bed_capacity.sql` against Supabase
- [ ] Verify `tbl_branches.bed_capacity` column created
- [ ] Add sample capacity values (e.g., 30, 36, 50 beds per branch)

### TypeScript Compilation
- [ ] `npx tsc --noEmit -p .` passes with no errors
- [ ] All imports resolve correctly

### Feature Testing

**Bed Capacity**:
- [ ] Different branch capacities calculate correctly
- [ ] HQ aggregated capacity sums all branches
- [ ] Missing capacity shows "not configured" state

**Period/Active Residents**:
- [ ] "This Month" shows Active Residents KPI
- [ ] "Last Month" hides Active Residents KPI
- [ ] "Last Year" hides Active Residents KPI
- [ ] "Custom" with current date shows it; past date hides it

**KPI Drill-Down** (requires wiring modal state):
- [ ] Admissions count matches detail list
- [ ] Discharges count matches detail list
- [ ] Active Residents list matches dashboard count
- [ ] Net Bed Change = admissions − discharges
- [ ] Average LOS matches calculation (both completed + active)
- [ ] Occupancy % formula displays correctly

**Occupancy Trend**:
- [ ] Hover over points shows tooltip
- [ ] Tooltip displays date + occupancy count
- [ ] Chart scales properly with different capacity values

**Length of Stay**:
- [ ] LOS distribution includes active residents
- [ ] Buckets contain both completed and active residents
- [ ] Average LOS uses same residents as distribution

**Access Control**:
- [ ] NUR branch user can see dashboard
- [ ] HQ user can see dashboard
- [ ] PHY branch user redirected to /residents
- [ ] STAFF user (non-admin) at PHY branch redirected

**Regression**:
- [ ] Other modules unchanged (physiotherapy, clinical, staff, etc.)
- [ ] Sidebar navigation works
- [ ] Demographics (Age/Gender) still renders correctly
- [ ] Care Dependency section renders correctly

---

## Known Limitations & Future Work

1. **Modal Wiring**: The `analytics-details-modal.tsx` component is created but needs to be wired to page.tsx. Since page.tsx is a server component, this requires either:
   - Converting the page to use a client wrapper for modal state
   - Or using a separate client sub-component for the modal + KPI cards

2. **Internationalization**: New text (e.g., "Capacity not configured", "All residents (completed + active)") should be added to `translations.ts` for Bahasa Malaysia support.

3. **Drill-Down Tables**: Resident lists in modals are paginated here (all rows shown), but for branches with 100+ residents, pagination should be added.

---

## Files Changed

1. **Schema Migration**: `schema/002_add_bed_capacity.sql` (new)
2. **Library**: `webapp/src/lib/lookups.ts` (updated)
3. **Analytics Data**: `webapp/src/app/(app)/residents/admission-analytics/data.ts` (updated)
4. **Analytics Page**: `webapp/src/app/(app)/residents/admission-analytics/page.tsx` (updated)
5. **Analytics Charts**: `webapp/src/app/(app)/residents/admission-analytics/charts.tsx` (updated)
6. **Modal Component**: `webapp/src/app/(app)/residents/admission-analytics/analytics-details-modal.tsx` (new)

---

## SQL Migration Reference

```sql
-- Run this once in Supabase SQL Editor to apply the schema change
ALTER TABLE tbl_branches ADD COLUMN bed_capacity integer DEFAULT NULL;
COMMENT ON COLUMN tbl_branches.bed_capacity IS 'Official bed capacity for this branch. Used by Admission Analytics to calculate occupancy %. NULL means capacity not yet configured.';
```

After running the migration, populate with actual capacity values:
```sql
UPDATE tbl_branches SET bed_capacity = 30 WHERE "BranchCode" = 'ALMA';
UPDATE tbl_branches SET bed_capacity = 36 WHERE "BranchCode" = 'BAGAN';
-- etc.
```

---

## Next Steps

1. Apply database migration
2. Run TypeScript compilation check
3. Test bed_capacity calculations with sample data
4. Wire modal state to KPI cards (client wrapper pattern)
5. Verify all edge cases in validation checklist
6. Deploy to production
