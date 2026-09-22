"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useDirtyForm } from "@/lib/dirty-form-context";

type RequestSaveFn = () => Promise<boolean>;

type Ctx = {
  isDirty: boolean;
  setDirty: (v: boolean) => void;
  requestSave: RequestSaveFn | null;
  setRequestSave: (fn: RequestSaveFn | null) => void;
};

const PhysioDirtyContext = createContext<Ctx | null>(null);

// Lets the resident picker (a sibling of the assessment form, both children
// of page.tsx) know whether the in-progress New Entry form has unsaved
// changes, and gives it a way to trigger that form's save before switching
// residents. The form registers/unregisters `requestSave` on mount/unmount
// and flips `isDirty` whenever the therapist actually edits something.
export function PhysioDirtyProvider({ children }: { children: React.ReactNode }) {
  const [isDirty, setDirty] = useState(false);
  const [requestSave, setRequestSaveState] = useState<RequestSaveFn | null>(null);

  const setRequestSave = useCallback((fn: RequestSaveFn | null) => {
    setRequestSaveState(() => fn);
  }, []);

  return (
    <PhysioDirtyContext.Provider value={{ isDirty, setDirty, requestSave, setRequestSave }}>
      {children}
    </PhysioDirtyContext.Provider>
  );
}

export function usePhysioDirty(): Ctx {
  const ctx = useContext(PhysioDirtyContext);
  if (!ctx) throw new Error("usePhysioDirty must be used within PhysioDirtyProvider");
  return ctx;
}

// Mirrors this module's own resident-switch dirty tracking (above) into the
// app-wide dirty-form guard, so sidebar links, the Assessments/Analytics and
// Inpatient/Outpatient tabs, and browser refresh/close all pick up the same
// "unsaved changes" state -- without touching the resident picker's own
// tailored save/discard dialog, which stays as the in-module UX for
// switching resident specifically.
export function PhysioGlobalDirtyBridge() {
  const { isDirty, requestSave } = usePhysioDirty();
  const { markDirty, markClean } = useDirtyForm("physio-assessment-new");

  useEffect(() => {
    if (isDirty) {
      markDirty(async () => {
        if (!requestSave) return { success: false, error: "This assessment can't be saved automatically." };
        const ok = await requestSave();
        return ok ? { success: true } : { success: false, error: "Couldn't save the current assessment." };
      });
    } else {
      markClean();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, requestSave]);

  return null;
}
