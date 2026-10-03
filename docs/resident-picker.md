# Resident pickers — mandatory pattern

**Every place a user picks a resident must use the shared combobox, never a
plain `<select>`.** A branch has far too many residents to scroll a native
dropdown one by one; the combobox lets the user either scroll the full list
or type part of a name / resident ID to narrow it.

## Which component

| Situation | Use |
|---|---|
| Residents shaped `{ id, resident_name }` (Clinical, most server queries) | `ResidentCombobox` — `src/components/resident-combobox.tsx` |
| Inventory forms (`InvResident[]`) | `ResidentSelect` — `src/app/(app)/inventory/components/form-bits.tsx` |
| Any other shape, or you need a resident ID hint / custom placeholder | `Combobox` — `src/components/combobox.tsx` with `options={residents.map(r => ({ id, label: name, hint: residentTextId }))}` |

Don't hand-roll another search input + `<ul>` dropdown — Medication Orders and
Medication Charts used to, and both were migrated onto `Combobox`.

## Rules

1. **Show the resident ID as `hint`** when you have it (`AMN-0138`). It is
   rendered dimmed beside the name and is searchable.
2. **Dirty guards work automatically.** Picking or clearing emits a real
   `input` event, so a form's `onChangeCapture={markDirty}` / `state.touch`
   hears it exactly like a native `<select>` change. Don't add manual
   `markDirty()` calls for the picker.
3. **URL-driven filters must ignore `reason === "type"`.** `Combobox.onChange`
   is `(id, reason)` where reason is `"select" | "clear" | "type"`. Typing over
   the current name reports `("", "type")`; navigating on it would reload the
   page mid-keystroke.
   - `ResidentCombobox` does this for you when `filterPlaceholder` is set
     (e.g. `filterPlaceholder={t("All residents")}`), which also adds the ×
     clear button.
   - With raw `Combobox`: `onChange={(id, reason) => { if (reason !== "type") go(id); }}`
     plus `clearable` and `placeholder={t("All residents")}`.
4. **Positioning is automatic** — don't add wrappers or `overflow-visible`
   hacks. The list is portalled to `<body>` with `position: fixed`, opens
   upward when there's more room above, caps its height to the visible space
   (visual viewport, so a phone keyboard counts as covered) and clamps to the
   screen width. Use `inputClassName={SMALL_INPUT_CLS}` for compact table rows.
5. **Labels:** the combobox renders its own `<label>`. Don't wrap it in another
   `<label>` (e.g. inventory `Field`). If the layout already has a visible
   label, pass `hideLabel` and keep the same `id` so `htmlFor` still points at
   the input.
   **Validation — keep whatever the field had before:**
   - was a native `required` `<select>` → `required` (blocks submit with
     "Please select an option from the list.");
   - only showed an asterisk and the form validated it itself → `showRequired`
     (asterisk only). Switching these to `required` adds a check the form never
     had.
   - FormData submits: pass `name` (hidden input) or keep the caller's own
     hidden inputs.
6. **Locked selection:** pass `disabled` (e.g. wound photo after the first
   upload).
7. All text goes through `t()`; `"No matching resident"` and
   `"Clear selection"` already exist in `dict-common.ts`.

## Behaviour (don't re-implement)

- Empty box → the whole list, uncapped and scrollable.
- Typing → case-insensitive substring match on name and hint.
- Arrow keys + Enter pick; Escape closes; Enter with nothing highlighted still
  submits the surrounding form.
- Leaving the field without picking drops the half-typed text (unless the
  caller uses `onQueryChange`, e.g. "add new supplier").
- Light/Dark themed via tokens.
