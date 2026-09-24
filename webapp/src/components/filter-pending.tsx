"use client";

import { createContext, useContext, useTransition } from "react";

type Ctx = {
  isPending: boolean;
  startNavigation: (fn: () => void) => void;
};

const FilterPendingContext = createContext<Ctx | null>(null);

// Wraps a filterable table so every ColumnFilter's navigation shares one
// pending state -- lets the whole table show a single loading overlay while
// Next.js re-fetches with the new filter, instead of the page silently
// sitting there with no feedback while the URL/search params update.
export function FilterPendingProvider({ children }: { children: React.ReactNode }) {
  const [isPending, startTransition] = useTransition();

  return (
    <FilterPendingContext.Provider value={{ isPending, startNavigation: startTransition }}>
      <div className="relative">
        {children}
        {isPending && (
          <div className="absolute inset-0 z-40 flex items-center justify-center rounded-md bg-white/60 dark:bg-gray-900/60 backdrop-blur-[1px]">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 dark:border-gray-800 border-t-indigo-600" />
          </div>
        )}
      </div>
    </FilterPendingContext.Provider>
  );
}

export function useFilterNavigation(): Ctx["startNavigation"] {
  const ctx = useContext(FilterPendingContext);
  // Falls back to a plain synchronous call when used outside a provider, so
  // ColumnFilter doesn't require every caller to wrap it.
  return ctx?.startNavigation ?? ((fn: () => void) => fn());
}
