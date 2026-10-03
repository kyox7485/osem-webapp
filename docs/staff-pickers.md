# Staff Pickers — rules for every new picker

## Rule 0 — always a combobox, never a plain `<select>`

Every staff picker uses the shared combobox (scroll the roster or type to
narrow it); the mechanics, validation and dirty-guard rules are the same as
`docs/resident-picker.md`.

| Situation | Use |
|---|---|
| Clinical / physio / residents / medication "by" fields that also accept a name not on the roster | `StaffPickerWithOther` |
| Inventory forms (`InvStaff[]`) | `StaffSelect` in `inventory/components/form-bits.tsx` |
| Anything else | `Combobox` (`hint: t("HQ")` for HQ staff where the list mixes branches) |

`StaffPickerWithOther` has **no "Others (specify below)" item any more** — the
user just types a name. A typed name that exactly matches a roster entry
(case-insensitive) selects that staff member; any other non-blank text is
reported exactly as the old Others choice was: `value = OTHERS_SENTINEL` and
the text via `onOtherNameChange`. So callers' validation
(`!value || (value === OTHERS_SENTINEL && !otherName.trim())`) and payloads
are unchanged. Native `required` is preserved (blank box blocks submit).
Existing "other" names re-display in the box via the `freeText` prop.

---

Every `<StaffPickerWithOther>` (and any future equivalent) in this project
must follow the two rules below. Both rules were applied project-wide in
October 2026 and are verified by TypeScript: any picker that breaks the
pattern will fail `tsc --noEmit`.

---

## Rule 1 — Physiotherapy exclusion

**Physiotherapy department staff must not appear in any staff picker** except
the physiotherapy-specific signoff fields (`getPhysiotherapyStaff()`, #13 in
the audit list).

All three staff-fetching helpers already enforce this server-side:

| Helper | Where used |
|---|---|
| `getStaffRoster(branchId)` | Branch-scoped read-only lookups (discharge, progress notes) |
| `getAllStaffWithBranch()` | Cross-branch pickers (resident form, clinical modules) |
| `getNursingStaff()` | Nursing chart / observation chart "entered by" |

Each helper has `.neq("department", "Physiotherapy")` in its query. Do **not**
use a raw `tbl_staff` query for a staff picker — wrap it in one of the helpers
above, or add the same `.neq` to a new helper you create.

---

## Rule 2 — HQ staff visibility

**HQ branch staff are only visible in a staff picker when the logged-in user
belongs to an HQ branch** (`account.branch_function === 'HQ'`).

### How it works

`getAllStaffWithBranch()` and `getNursingStaff()` both return the field
`branch_function: string` (populated via `tbl_branches(Function)`). The value
is `'HQ'`, `'NUR'`, or `'PHY'`.

Every client-side filter that restricts the picker to the selected resident's
branch **must** also pass HQ staff through:

```ts
// ✅ correct — include HQ staff for HQ users
const staffOptions = allStaff.filter(
  (s) => s.branch_id === selectedBranchId || s.branch_function === 'HQ'
);

// ❌ wrong — silently hides HQ staff from the picker
const staffOptions = allStaff.filter((s) => s.branch_id === selectedBranchId);
```

Because `allStaff` only contains HQ staff when the server pre-merges them
(which it does only for HQ users), the `s.branch_function === 'HQ'` clause is
a no-op for non-HQ users — their list simply has no HQ entries to pass
through. You do **not** need to thread `isHqUser` into form components; the
merging happens one level up.

### Where the merge happens

| Entry point | How HQ staff enter the list |
|---|---|
| `ClinicalContent` | `effectiveNursingStaff = isHqUser ? [...nursingStaff, ...hqStaff] : nursingStaff` — merged before passing to `NursingChartModule` and `ObservationChartModule` |
| `ResidentForm` | `staffForBranch` filter includes `s.branch_function === 'HQ'` when `isHqUser=true` (prop from server page) |
| `residents/[id]/progress-notes/page.tsx` | Server pre-filters: `allStaff.filter(s => s.branch_id === resident.branch_id \|\| (isHqUser && s.branch_function === 'HQ'))` |
| `residents/medication/orders` | Same pre-filter on the server before building `StaffEntry[]` |
| All other clinical form components | `allStaff` passed down already contains HQ entries for HQ users; the `branch_function === 'HQ'` clause in each form's filter admits them |

### Server pages must compute `isHqUser`

Any page that fetches staff and passes them to a component must compute:

```ts
const isHqUser = account.branch_function === 'HQ';
```

and either pass it as a prop (when a component needs to merge HQ staff itself)
or use it to pre-filter the staff list before passing a plain `LookupOption[]`.

---

## Checklist for a new staff picker

1. Fetch staff with `getAllStaffWithBranch()` (or `getNursingStaff()` for
   nursing-only pickers). Never raw-query `tbl_staff` — you'll miss the
   `status=ACTIVE` filter, the Physiotherapy exclusion, and `branch_function`.
2. Ensure the type carries `branch_function: string`:
   ```ts
   allStaff: (LookupOption & { branch_id: number; branch_function: string })[]
   ```
3. Filter with the inclusive pattern:
   ```ts
   allStaff.filter((s) => s.branch_id === selectedBranchId || s.branch_function === 'HQ')
   ```
4. In the server page, compute `isHqUser = account.branch_function === 'HQ'`
   and use it to either pre-filter or merge HQ staff before passing to the
   component.
5. Run `npx tsc --noEmit -p webapp` — the type change from step 2 will catch a
   missing `branch_function` at compile time.
