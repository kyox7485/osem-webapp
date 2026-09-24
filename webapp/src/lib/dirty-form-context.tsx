"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { translate, LANGUAGE_COOKIE } from "@/lib/i18n/translate";

// DirtyFormProvider is mounted above LanguageProvider in the root layout
// (its dialog must be able to guard navigation everywhere LanguageProvider
// itself renders), so it can't call useTranslation(). Reads the language
// cookie directly instead -- same cookie LanguageProvider's setLanguage()
// writes, so it stays in sync without a shared ancestor.
function tFallback(text: string): string {
  const language = typeof document !== "undefined" && document.cookie.includes(`${LANGUAGE_COOKIE}=ms`) ? "ms" : "en";
  return translate(text, language);
}

export type SaveResult = { success: boolean; error?: string };
export type UnsavedChangesAction = "save" | "discard" | "cancel";

type FormRef = {
  id: string;
  onSaveAndExit?: () => Promise<SaveResult>;
};

type DirtyFormContextType = {
  /** id of the form currently holding unsaved changes, or null if none. */
  dirtyFormId: string | null;
  registerDirtyForm: (ref: FormRef) => void;
  unregisterDirtyForm: (id: string) => void;
  clearDirtyForm: (id: string) => void;
  /** True while the unsaved-changes dialog is open. */
  dialogOpen: boolean;
  dialogSaving: boolean;
  dialogError: string | null;
  /**
   * The single entry point every navigation-triggering action in the app
   * should go through. Runs `action` immediately if nothing is dirty;
   * otherwise stashes it and opens the confirmation dialog.
   */
  guardAction: (action: () => void) => void;
  /** Resolves the currently open dialog (Save & Exit / Exit Without Saving / Cancel). */
  resolveDialog: (choice: UnsavedChangesAction) => void;
};

const DirtyFormContext = createContext<DirtyFormContextType | null>(null);

export function DirtyFormProvider({ children }: { children: ReactNode }) {
  const [dirtyFormId, setDirtyFormId] = useState<string | null>(null);
  const formRefsRef = useRef<Map<string, FormRef>>(new Map());
  const pendingActionRef = useRef<(() => void) | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogSaving, setDialogSaving] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const registerDirtyForm = useCallback((ref: FormRef) => {
    formRefsRef.current.set(ref.id, ref);
    setDirtyFormId(ref.id);
  }, []);

  const unregisterDirtyForm = useCallback((id: string) => {
    formRefsRef.current.delete(id);
    setDirtyFormId((current) => (current === id ? null : current));
  }, []);

  const clearDirtyForm = useCallback((id: string) => {
    setDirtyFormId((current) => (current === id ? null : current));
  }, []);

  const guardAction = useCallback(
    (action: () => void) => {
      if (!dirtyFormId) {
        action();
        return;
      }
      pendingActionRef.current = action;
      setDialogError(null);
      setDialogOpen(true);
    },
    [dirtyFormId]
  );

  const resolveDialog = useCallback(
    (choice: UnsavedChangesAction) => {
      if (choice === "cancel") {
        pendingActionRef.current = null;
        setDialogOpen(false);
        setDialogError(null);
        return;
      }

      if (choice === "discard") {
        const action = pendingActionRef.current;
        pendingActionRef.current = null;
        if (dirtyFormId) {
          unregisterDirtyForm(dirtyFormId);
        }
        setDialogOpen(false);
        setDialogError(null);
        action?.();
        return;
      }

      // choice === "save"
      const currentId = dirtyFormId;
      const formRef = currentId ? formRefsRef.current.get(currentId) : undefined;
      if (!formRef?.onSaveAndExit) {
        setDialogError(tFallback("This form can't be saved automatically."));
        return;
      }

      setDialogSaving(true);
      setDialogError(null);
      formRef
        .onSaveAndExit()
        .then((result) => {
          setDialogSaving(false);
          if (!result.success) {
            setDialogError(result.error || tFallback("Save failed. Please try again."));
            return;
          }
          if (currentId) unregisterDirtyForm(currentId);
          setDialogOpen(false);
          const action = pendingActionRef.current;
          pendingActionRef.current = null;
          action?.();
        })
        .catch(() => {
          setDialogSaving(false);
          setDialogError(tFallback("Save failed. Please try again."));
        });
    },
    [dirtyFormId, unregisterDirtyForm]
  );

  // Standard browser-native warning on refresh / close tab / external nav.
  // Modern browsers ignore custom messages and show their own generic
  // wording -- that's a browser limitation, not something we can style.
  useEffect(() => {
    if (!dirtyFormId) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirtyFormId]);

  return (
    <DirtyFormContext.Provider
      value={{
        dirtyFormId,
        registerDirtyForm,
        unregisterDirtyForm,
        clearDirtyForm,
        dialogOpen,
        dialogSaving,
        dialogError,
        guardAction,
        resolveDialog,
      }}
    >
      {children}
    </DirtyFormContext.Provider>
  );
}

function useDirtyFormContext() {
  const context = useContext(DirtyFormContext);
  if (!context) {
    throw new Error("useDirtyForm/useSafeNavigation must be used within DirtyFormProvider");
  }
  return context;
}

/**
 * Per-form dirty tracking. `formId` must be unique for every simultaneously
 * mounted form instance (e.g. include the record id for edit forms so two
 * open edit forms don't share state).
 */
export function useDirtyForm(formId: string) {
  const context = useDirtyFormContext();
  const { dirtyFormId, registerDirtyForm, unregisterDirtyForm, clearDirtyForm } = context;

  const markDirty = useCallback(
    (onSaveAndExit?: () => Promise<SaveResult>) => {
      registerDirtyForm({ id: formId, onSaveAndExit });
    },
    [formId, registerDirtyForm]
  );

  const markClean = useCallback(() => {
    clearDirtyForm(formId);
  }, [formId, clearDirtyForm]);

  const unregister = useCallback(() => {
    unregisterDirtyForm(formId);
  }, [formId, unregisterDirtyForm]);

  const isDirty = dirtyFormId === formId;

  return { isDirty, markDirty, markClean, unregister };
}

/** Read-only access to whether ANY form in the app is currently dirty. */
export function useIsAnyFormDirty() {
  const { dirtyFormId } = useDirtyFormContext();
  return dirtyFormId !== null;
}

export function useDirtyFormDialogState() {
  const { dialogOpen, dialogSaving, dialogError, resolveDialog } = useDirtyFormContext();
  return { dialogOpen, dialogSaving, dialogError, resolveDialog };
}

export function useGuardedNavigation() {
  const { guardAction } = useDirtyFormContext();
  return guardAction;
}
