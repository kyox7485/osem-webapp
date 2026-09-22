# Admission Analytics Optimization — Deployment Instructions

## ✅ Code Committed

**Commit**: `cae6559`  
**Branch**: `main`  
**Pushed**: Yes, to `origin/main`

All code changes have been committed and pushed. The following files are included:

```
schema/002_add_bed_capacity.sql                          (NEW)
webapp/src/lib/lookups.ts                                (MODIFIED)
webapp/src/app/.../admission-analytics/data.ts          (MODIFIED)
webapp/src/app/.../admission-analytics/page.tsx         (MODIFIED)
webapp/src/app/.../admission-analytics/charts.tsx       (MODIFIED)
webapp/src/app/.../admission-analytics/analytics-details-modal.tsx (NEW)
IMPLEMENTATION_SUMMARY.md                                (NEW)
```

---

## 🔧 Database Migration — MANUAL STEP REQUIRED

The code is ready, but the database schema change must be applied manually.

### Step 1: Apply Migration in Supabase SQL Editor

1. Go to **Supabase Dashboard** → Your OSEM project → **SQL Editor**
2. Create a new query and paste the following SQL:

```sql
-- Add bed_capacity column to tbl_branches
ALTER TABLE tbl_branches ADD COLUMN bed_capacity integer DEFAULT NULL;

-- Document the column
COMMENT ON COLUMN tbl_branches.bed_capacity IS 'Official bed capacity for this branch. Used by Admission Analytics to calculate occupancy %. NULL means capacity not yet configured.';
```

3. Click **Run**
4. Verify the column was created (no errors)

### Step 2: Populate Bed Capacity Values

After the column is created, add the actual bed capacity for each branch:

```sql
-- Example: Replace with actual capacities for each branch
UPDATE tbl_branches SET bed_capacity = 30 WHERE "BranchCode" = 'ALMA';
UPDATE tbl_branches SET bed_capacity = 36 WHERE "BranchCode" = 'BAGAN';
-- Add more branches as needed
```

### Step 3: Verify in Application

1. Restart the web app (or wait for auto-reload if using Vercel)
2. Navigate to **Residents** → **Admission Analytics**
3. Check the **Occupancy %** KPI card:
   - If bed_capacity is set: Shows percentage and "X/Y beds"
   - If bed_capacity is NULL: Shows "–" and "Capacity not configured"

---

## ✅ Features Ready to Use

Once the migration is applied:

### 1. **Occupancy % Calculation**
- Uses actual bed_capacity from database
- For HQ view: aggregates capacity across all selected branches
- Formula: (Active Residents / Total Bed Capacity) × 100

### 2. **Active Residents KPI Period-Aware**
- Shows when viewing "This Month" or current year
- Hidden for "Last Month", "Last Year", or custom past dates
- Prevents showing stale "current" occupancy for historical views

### 3. **KPI Drill-Down** (Code ready, needs state wiring)
- All KPI cards show "Click for details" affordance
- Modal component created; needs client state management wired
- When clicked, shows:
  - Admissions: List of residents admitted in period
  - Discharges: List of residents discharged with dates
  - Active Residents: Current active residents with LOS
  - Net Bed Change: Breakdown (admissions − discharges)
  - Length of Stay: Explanation + resident data
  - Occupancy: Formula + branch-level breakdown

### 4. **Length of Stay Enhanced**
- Now includes BOTH completed and active residents
- Active residents: LOS = dashboard date − admission_date
- Completed residents: LOS = discharge_date − admission_date
- Subtitle changed from "Completed stays only" to "All residents (completed + active)"

### 5. **Occupancy Trend Chart**
- Improved hover targets (larger invisible click zones)
- Helpful text: "Hover over data points to see details"
- Tooltips show date + occupancy count

### 6. **Access Control**
- NUR branch users: Can access Admission Analytics ✅
- HQ users: Can access Admission Analytics ✅
- PHY (physiotherapy hub) users: Redirected to /residents (blocked)
- Other function types: Blocked from accessing the dashboard

---

## 🚀 Post-Migration Testing

After applying the database migration, test the following:

### Bed Capacity
- [ ] Set different capacities for different branches (e.g., 30, 36, 50)
- [ ] Verify occupancy % calculates correctly
- [ ] Test HQ aggregated capacity (should sum all branches)
- [ ] Verify "Capacity not configured" appears for NULL capacity

### Period-Aware Display
- [ ] "This month" → Active Residents KPI visible
- [ ] "Last month" → Active Residents KPI hidden
- [ ] "Last year" → Active Residents KPI hidden
- [ ] Custom with past date → Hidden; custom with current date → Visible

### Length of Stay
- [ ] LOS distribution includes active residents
- [ ] LOS buckets contain expected counts
- [ ] Average LOS matches calculation

### Occupancy Trend
- [ ] Chart displays with correct data
- [ ] Hover over points shows tooltip
- [ ] "Hover over data points to see details" message visible

### Access Control
- [ ] NUR user can view dashboard
- [ ] HQ user can view dashboard
- [ ] PHY user redirected to /residents
- [ ] Non-admin at PHY branch cannot access

---

## 📋 Final Checklist

- [ ] Database migration applied (tbl_branches.bed_capacity column created)
- [ ] Bed capacity values populated for all branches
- [ ] Code deployed/live (already committed to main)
- [ ] Admission Analytics page loads without errors
- [ ] All KPI cards render with correct values
- [ ] Active Residents hides for non-current periods
- [ ] Occupancy % shows when capacity configured
- [ ] Length of Stay subtitle shows "(completed + active)"
- [ ] Occupancy Trend chart displays
- [ ] Access control working (NUR/HQ only)

---

## 📞 Support

If you encounter issues:

1. **Page not loading**: Check TypeScript errors with `npm run lint`
2. **Occupancy % still shows "Capacity not configured"**: Verify column was created and values were inserted
3. **Active Residents doesn't hide**: Clear browser cache and reload
4. **Database connection error**: Verify Supabase credentials and RLS policies

---

## 🔄 Next Phase (Optional)

To fully complete the drill-down feature:

1. Wire the modal state to page.tsx (requires client wrapper component)
2. Pass click handlers to KPI cards
3. Update modal to receive actual resident data from the page

The modal component is fully built and ready in:
`webapp/src/app/.../admission-analytics/analytics-details-modal.tsx`

See `IMPLEMENTATION_SUMMARY.md` for technical details.
