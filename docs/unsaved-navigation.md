# Unsaved-changes protection system — detail

Every New Entry / Create / Edit form in the app is protected by a single
app-wide dirty-form guard (built 2026-09-23) — not a per-form ad hoc
implementation. Core pieces, all in `webapp/src/lib/`:

- `dirty-form-context.tsx` — `DirtyFormProvider`, mounted once in the root
  `app/layout.tsx`. Single source of truth for which form (if any) is
  dirty, its save handler, and the confirmation dialog's state, including
  the native `beforeunload` listener (one listener for the whole app, not
  one per form).
- `use-form-dirty-tracking.tsx` — `useFormDirtyTracking(formId, onSaveAndExit)`
  → `{ markDirty, markClean }`. The one-line way to wire a form in: put
  `onChangeCapture={markDirty}` on the form's outer element (catches every
  native input/select/textarea/checkbox change via React's event
  delegation, without touching each field's own `onChange`) and add an
  explicit `markDirty()` call at any custom chip/toggle handler that
  doesn't fire a real change event.
- `use-safe-navigation.tsx` — `useSafeNavigation()` → `{ navigateTo, goBack,
  guardedAction }`, for a module's own in-app navigation: sub-tab
  switches, resident/patient switches, closing a modal. Wrap the existing
  handler, e.g. `onClick={() => guardedAction(() => setInnerTab("review"))}`.
- `webapp/src/components/navigation-guard.tsx` — one global `<a>` click
  interceptor mounted in root layout that catches sidebar links and any
  other `<Link>` app-wide, so individual nav components never need to know
  about the guard.
- `webapp/src/components/unsaved-changes-dialog.tsx` — the one global
  dialog (Cancel / Exit Without Saving / Save & Exit), driven entirely by
  context state.

Two pre-existing **module-local** dirty-tracking implementations were
found already in place (physiotherapy's `physio-dirty-context.tsx` for
resident-switch, and a local Cancel-modal inside `order-form.tsx` /
`resident-form.tsx`) — rather than duplicate them, they're bridged into
the global context (see `PhysioGlobalDirtyBridge` in
`physiotherapy/physio-dirty-context.tsx`, and the `useDirtyForm(...)`
registration inside `order-form.tsx`/`resident-form.tsx`) so sidebar and
module-tab navigation respects them too, while keeping their own
resident-switch/Cancel-button UX unchanged.

**Every module's own sub-tab switch (e.g. "Review Notes" ↔ "New Entry",
Inpatient ↔ Outpatient) must explicitly call `guardedAction(...)` around
its `setTab`/`setInnerTab` call.** The global click interceptor only
catches real `<a>` navigation — a local `useState` tab toggle produces no
navigation event for it to see. Two of these were missed on the first
pass and had to be fixed after the fact: `physiotherapy/care-setting-tabs.tsx`
(Inpatient/Outpatient) and `physiotherapy/assessment-tabs.tsx` (Review
Notes/New Entry) — if you add a new sub-tab anywhere, guard it the same
way or dirty data will be silently discarded on tab switch.

**Known footgun:** inside `useFormDirtyTracking`'s `markDirty`, never call
`registerDirty(...)` (which sets state on `DirtyFormProvider`, a different
component) from inside the functional updater passed to `setLocalDirty`.
React logs "Cannot update a component while rendering a different
component" and can silently drop the registration under some render
timing — this was a real, shipped bug (the guard intermittently failed to
fire) fixed by calling `registerDirty()` directly in the handler and
`setLocalDirty(true)` as a separate plain call, not nested inside the
updater.
