"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDirtyForm, type SaveResult } from "./dirty-form-context";

/**
 * Dirty-tracking for a New Entry / Create / Edit form.
 *
 * ```tsx
 * const { markDirty, markClean } = useFormDirtyTracking("nursing-chart-new", onSaveAndExit);
 *
 * // Wrap the form's outer element so any field edit marks it dirty, without
 * // having to touch every individual input's own onChange:
 * <div onChangeCapture={markDirty} onClickCapture={handleCustomToggleDirty}>
 *
 * // After a successful save:
 * markClean();
 * ```
 *
 * `onSaveHandler` is read via a ref on every call, so passing a fresh
 * closure on every render (the common case, since it captures current form
 * state) is fine -- it never re-registers a stale save handler.
 */
export function useFormDirtyTracking(formId: string, onSaveHandler: () => Promise<SaveResult>) {
  const { isDirty, markDirty: registerDirty, markClean, unregister } = useDirtyForm(formId);
  const [localDirty, setLocalDirty] = useState(false);
  const handlerRef = useRef(onSaveHandler);
  useEffect(() => {
    handlerRef.current = onSaveHandler;
  });

  // Calls registerDirty directly rather than from inside setLocalDirty's
  // updater -- registerDirty ultimately calls setState on DirtyFormProvider,
  // a *different* component, and doing that from inside another component's
  // state updater is a React anti-pattern ("Cannot update a component while
  // rendering a different component") that can cause the registration to be
  // dropped under some render timing. registerDirtyForm is idempotent, so
  // calling it on every markDirty() (not just the was-clean -> dirty edge)
  // is harmless.
  const markDirty = useCallback(() => {
    registerDirty(() => handlerRef.current());
    setLocalDirty(true);
  }, [registerDirty]);

  const markCleanLocal = useCallback(() => {
    setLocalDirty(false);
    markClean();
  }, [markClean]);

  useEffect(() => {
    return () => {
      unregister();
    };
  }, [unregister]);

  return {
    isDirty: isDirty && localDirty,
    markDirty,
    markClean: markCleanLocal,
  };
}
