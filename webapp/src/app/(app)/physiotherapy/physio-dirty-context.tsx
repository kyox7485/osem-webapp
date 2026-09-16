"use client";

import { createContext, useContext, useState, useCallback } from "react";

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
